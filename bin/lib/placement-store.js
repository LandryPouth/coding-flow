"use strict";

// Low-level storage for a chain's recorded placement (story-03-01): one JSON
// file per epic, under `git rev-parse --git-common-dir` so it is readable
// from any of the epic's worktrees, guarded by a filesystem lock so
// concurrent claims/clears never silently overwrite each other. Pure I/O, no
// chain-graph logic (see `backbone.js`) and no knowledge of `worktreeAdd`
// (see `worktree.js`) — kept dependency-free on purpose so both `worktree.js`
// (auto-land, story-03-02) and `worktree-plan.js` (placement, story-03-01)
// can require it without creating a cycle between themselves.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const { readJson, writeJson } = require("./util");

function gitCommonDir(cwd) {
  const out = execFileSync("git", ["rev-parse", "--git-common-dir"], { cwd, encoding: "utf8" }).trim();
  return path.resolve(cwd, out);
}

function placementStatePath(cwd, epicName) {
  return path.join(gitCommonDir(cwd), "coding-flow", "worktree-plan", `${epicName}.json`);
}

function readPlacementState(cwd, epicName) {
  return readJson(placementStatePath(cwd, epicName), { chains: {} });
}

// A plain read-then-write of the placement JSON is not enough on its own:
// even a single synchronous call has a real (if usually small) gap between
// its read and its write, because the write is real disk I/O
// (`mkdirSync`/`writeFileSync`/`renameSync`), not a memory operation. Two
// processes racing for two different, both not-yet-settled chains can each
// read the same pre-write state and each write back a full-state object that
// does not include the other's change — whichever renames last silently wins
// and the other's change vanishes with no error on either side (verified by
// racing the real function against a real repo in story-03-01). So every
// read-decide-write on this file runs inside an exclusive, filesystem-level
// lock — one process at a time per epic, held only for the caller's own body,
// never across `worktreeAdd`/`worktree land`'s own git calls.
const LOCK_WAIT_TIMEOUT_MS = 5000;
const LOCK_RETRY_DELAY_MS = 20;
const LOCK_STALE_MS = 30000;

// Dummy buffer for Atomics.wait's required Int32Array — never actually
// signaled, only used for its timeout as a real (non-spinning) sleep.
const RETRY_SIGNAL = new Int32Array(new SharedArrayBuffer(4));

// General-purpose exclusive filesystem lock, factored out of the placement
// state's own use below so `worktree.js` can reuse the exact same primitive
// (wait/steal-if-stale semantics included) to serialize `worktree land`
// against the shared main checkout (story-03-02, the /flow-review pass that
// found two concurrent auto-lands could otherwise race destructively on the
// same working directory) — not just this module's JSON file.
//
// `waitTimeoutMs`/`staleMs` are overridable per call: this module's own JSON
// read+write is fast and bounded, so the small defaults below are right for
// it, but `land`'s critical section runs real, unbounded project validation
// commands — a caller with a much longer-running body must pass longer
// values, or a legitimately still-running holder gets timed out on, or has
// its lock stolen by a waiter that mistook "still working" for "crashed".
function withFileLock(lockPath, fn, { waitTimeoutMs = LOCK_WAIT_TIMEOUT_MS, staleMs = LOCK_STALE_MS } = {}) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });

  const deadline = Date.now() + waitTimeoutMs;
  let fd = null;
  while (fd === null) {
    try {
      fd = fs.openSync(lockPath, "wx");
    } catch (err) {
      if (err.code !== "EEXIST") throw err;

      // A lock left behind by a crashed/killed process — or one abandoned by
      // `fail()`'s `process.exit()`, which terminates before any `finally`
      // on the stack (including this function's own, below) gets a chance to
      // run — must not deadlock every later call forever. Stealing it once
      // it is well past any realistic hold time is safer than an
      // unrecoverable stuck lock.
      const stat = fs.statSync(lockPath, { throwIfNoEntry: false });
      if (stat && Date.now() - stat.mtimeMs > staleMs) {
        fs.rmSync(lockPath, { force: true });
        continue;
      }

      if (Date.now() > deadline) {
        throw new Error(`timed out waiting for the lock: ${lockPath}`);
      }

      // A real blocking wait, not a CPU-spinning one: `Atomics.wait` blocks
      // the thread on the kernel side for the given duration without
      // burning a core, while still being a plain synchronous call — no
      // daemon, no async coordination.
      Atomics.wait(RETRY_SIGNAL, 0, 0, LOCK_RETRY_DELAY_MS);
    }
  }

  try {
    return fn();
  } finally {
    fs.closeSync(fd);
    fs.rmSync(lockPath, { force: true });
  }
}

function withPlacementLock(statePath, fn) {
  return withFileLock(`${statePath}.lock`, fn);
}

function claimChainIfPossible(cwd, epicName, chainId, location) {
  const statePath = placementStatePath(cwd, epicName);

  return withPlacementLock(statePath, () => {
    const state = readJson(statePath, { chains: {} });
    const existing = state.chains[chainId];
    if (existing) {
      return { status: "already-recorded", location: existing.location };
    }

    const occupyingChain = Object.entries(state.chains).find(
      ([otherChainId, entry]) => otherChainId !== chainId && path.resolve(entry.location) === path.resolve(location),
    );
    if (occupyingChain) {
      return { status: "occupied", occupyingChain };
    }

    state.chains[chainId] = { location };
    writeJson(statePath, state);
    return { status: "claimed", location };
  });
}

// Removes a chain's recorded placement once its worktree has landed
// (story-03-02) — a later story that happens to reuse the same chain slot
// must not silently reuse a stale, already-landed worktree path. No-op (not
// an error) when the chain has no recorded entry, so a land triggered for a
// chain that was never isolated in its own worktree (nothing was ever
// claimed for it beyond the primary checkout) is safe to call unconditionally.
function clearChainPlacement(cwd, epicName, chainId) {
  const statePath = placementStatePath(cwd, epicName);

  return withPlacementLock(statePath, () => {
    const state = readJson(statePath, { chains: {} });
    if (!(chainId in state.chains)) {
      return { cleared: false };
    }
    delete state.chains[chainId];
    writeJson(statePath, state);
    return { cleared: true };
  });
}

module.exports = {
  gitCommonDir,
  placementStatePath,
  readPlacementState,
  claimChainIfPossible,
  clearChainPlacement,
  withFileLock,
};
