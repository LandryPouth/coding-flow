"use strict";

// Decides where a story runs — continuing the location its dependency chain
// already occupies, or opening a new worktree because it starts a new chain
// relative to what is already running — and remembers that decision so a
// later `/flow-run` invocation (a different terminal, a different session)
// reads it instead of re-deriving or re-guessing it.
//
// The state has to be readable from ANY of an epic's worktrees, not just the
// one it happens to be written from: `git rev-parse --git-common-dir` is the
// one location every worktree of a repository shares, regardless of which
// checkout you run it from (unlike `.coding-flow/` inside a given worktree,
// which is deliberately per-checkout — see worktree.js's comment on
// `active-story.json`). One small JSON file per epic, read fresh on every
// call: no resident process, same one-process-per-decision spirit as the
// guard (docs/agent-contract.md §2), even though this is not the guard.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const { readJson, writeJson } = require("./util");
const { parseBackbone, labelForDir } = require("./backbone");
const { worktreeAdd, requireRepo } = require("./worktree");

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
// processes racing `claimChainIfPossible` for two different, both
// not-yet-claimed chains can each read the same pre-write state, both decide
// "unoccupied"/"claim it", and then each write back a full-state object that
// does not include the other's entry — whichever renames last silently wins
// and the other's claim vanishes with no error on either side (verified by
// racing the real function against a real repo; a synthetic no-op delay
// between read and write reproduces it reliably). That is exactly the
// isolation failure this story exists to prevent (spec's concurrency edge
// case: "must not let one silently overwrite the other's recorded
// location"), so the read-decide-write below runs inside an exclusive,
// filesystem-level lock — one process at a time per epic, held only for this
// function's own body, never across `worktreeAdd`/`npm install`.
const LOCK_WAIT_TIMEOUT_MS = 5000;
const LOCK_RETRY_DELAY_MS = 20;
const LOCK_STALE_MS = 30000;

// Dummy buffer for Atomics.wait's required Int32Array — never actually
// signaled, only used for its timeout as a real (non-spinning) sleep.
const RETRY_SIGNAL = new Int32Array(new SharedArrayBuffer(4));

function withPlacementLock(statePath, fn) {
  const lockPath = `${statePath}.lock`;
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });

  const deadline = Date.now() + LOCK_WAIT_TIMEOUT_MS;
  let fd = null;
  while (fd === null) {
    try {
      fd = fs.openSync(lockPath, "wx");
    } catch (err) {
      if (err.code !== "EEXIST") throw err;

      // A lock left behind by a crashed/killed process must not deadlock
      // every later call forever — stealing it after it is well past any
      // realistic hold time (this function does one JSON read+write, never
      // `worktreeAdd`) is safer than an unrecoverable stuck lock.
      const stat = fs.statSync(lockPath, { throwIfNoEntry: false });
      if (stat && Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
        fs.rmSync(lockPath, { force: true });
        continue;
      }

      if (Date.now() > deadline) {
        throw new Error(`timed out waiting for the worktree placement lock: ${lockPath}`);
      }

      // A real blocking wait, not a CPU-spinning one: `Atomics.wait` blocks
      // the thread on the kernel side for the given duration without
      // burning a core, while still being a plain synchronous call — no
      // daemon, no async coordination, matches docs/agent-contract.md's
      // "core stays boring" stance elsewhere in this codebase.
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

function epicNameFromPath(epicPath) {
  return path.basename(epicPath);
}

// `epicPath` and `storyPath` are project-root-relative, the same shape
// `storage.listEpics()` already returns (e.g. `epics/epic-19-.../`,
// `epics/epic-19-.../story-19-01-.../`). Throws when the story is not
// actually listed in the epic's `## Stories` — the same "fail loudly rather
// than guess a placement" rule `backbone.js` already applies to a malformed
// tree.
function decidePlacement({ cwd, epicPath, storyPath }) {
  const root = requireRepo(cwd);

  // `cwd` here is the coding-flow *project* root (context.js walks up to the
  // nearest `.coding-flow/`, deliberately not the git root — "a repo holding
  // several installs" gets its own project root per install). A git worktree
  // is inherently a whole-repository concept: `worktreeAdd` always creates a
  // full checkout sibling to the *git* root (worktree.js's `worktreeDest`),
  // regardless of which project subdirectory asked for it. If the two roots
  // ever diverge, "here" (recorded for the in-place case) and "the new
  // worktree" (created relative to the git root) would silently stop being
  // comparable locations — fail loudly instead of recording a placement that
  // cannot be trusted, same principle as backbone.js's malformed-tree guard.
  if (path.resolve(root) !== path.resolve(cwd)) {
    throw new Error(
      "worktree placement requires the coding-flow project root to be the git repository root " +
        `(project root "${cwd}" is inside git repo "${root}"). Multi-install monorepos are not supported ` +
        `for automatic placement yet — place this story manually: ai-flow worktree add --story ${storyPath}`,
    );
  }

  const indexPath = path.join(cwd, epicPath, "index.md");
  if (!fs.existsSync(indexPath)) {
    throw new Error(`epic index not found: ${epicPath}/index.md`);
  }

  const { storyDirs, chainId: chainIds } = parseBackbone(fs.readFileSync(indexPath, "utf8"));
  const storyDirName = path.basename(storyPath);
  const label = labelForDir(storyDirs, storyDirName);

  if (!label) {
    throw new Error(`story "${storyDirName}" is not listed in ${epicPath}/index.md's ## Stories`);
  }

  const chainId = chainIds.get(label);
  const epicName = epicNameFromPath(epicPath);
  const here = path.resolve(cwd);

  const attempt = claimChainIfPossible(cwd, epicName, chainId, here);
  if (attempt.status === "already-recorded") {
    return { location: attempt.location, created: false, chainId, label, parallelTo: null };
  }
  if (attempt.status === "claimed") {
    return { location: here, created: false, chainId, label, parallelTo: null };
  }

  // "occupied": a different chain already sits at `here` — open a new
  // worktree, then attempt to claim again against that fresh location.
  // `result.path` is a directory this call alone just created, so besides
  // "claimed" the only realistic outcome is "already-recorded": a
  // concurrent call for this exact chain (e.g. a different dependent story
  // of the same not-yet-placed chain, invoked at nearly the same moment)
  // won the write first, in which case its location is reused rather than
  // stranding this call's own freshly-created worktree as the recorded one.
  //
  // quiet: this call's own progress lines would otherwise interleave with
  // (and, under --json, corrupt) the single consolidated summary the CLI
  // wrapper (`ai-flow worktree place`) prints from the return value below.
  const [occupyingChainId, occupyingEntry] = attempt.occupyingChain;
  const result = worktreeAdd(storyDirName, { cwd, story: storyPath, quiet: true });
  const claim = claimChainIfPossible(cwd, epicName, chainId, result.path);

  if (claim.status === "already-recorded") {
    return { location: claim.location, created: false, chainId, label, parallelTo: null };
  }

  if (claim.status === "occupied") {
    // The freshly created worktree's own directory is already recorded for a
    // different chain — only reachable via stale placement state (that
    // chain's worktree was removed outside `ai-flow worktree` without
    // clearing its recorded location, and this call's deterministic
    // per-story dest happened to land on the same path). Fail loudly rather
    // than silently reporting success on a claim that was never persisted —
    // but the worktree this call just created was never recorded anywhere
    // either, so leaving it on disk would silently block every future
    // `worktreeAdd` at this exact deterministic path (its own
    // `fs.existsSync` guard) and turn "fix the entry and retry" into a lie.
    // Remove it before failing, so the placement state is the only thing
    // left for the caller to fix.
    const [staleChainId, staleEntry] = claim.occupyingChain;
    try {
      execFileSync("git", ["worktree", "remove", "--force", result.path], { cwd, stdio: "ignore" });
      // `git worktree remove` deliberately keeps the branch (no commit is
      // ever lost) — correct when removing a worktree someone was actually
      // using, but this branch was created by this call alone, moments ago,
      // for a worktree that never got recorded anywhere and is now gone
      // too. Left behind, it would silently accumulate one throwaway branch
      // per stale-state conflict. Only delete it when this call is the one
      // that created it (`branchCreated`) — never a branch `worktreeAdd`
      // reused, which predates this call and may carry real history.
      if (result.branchCreated) {
        execFileSync("git", ["branch", "-D", result.branch], { cwd, stdio: "ignore" });
      }
    } catch (cleanupErr) {
      throw new Error(
        `worktree placement conflict: the newly created worktree at "${result.path}" is already recorded for ` +
          `chain "${staleChainId}" (${staleEntry.location}) in the placement state, AND cleaning up that new, ` +
          `never-recorded worktree failed (${cleanupErr.message}). Remove it manually with ` +
          `\`git worktree remove --force ${result.path}\`${result.branchCreated ? ` and \`git branch -D ${result.branch}\`` : ""}, ` +
          `then delete the stale entry for chain "${staleChainId}" from the placement state and retry.`,
      );
    }
    throw new Error(
      `worktree placement conflict: the location a new worktree would need for chain "${chainId}" is already ` +
        `recorded for chain "${staleChainId}" (${staleEntry.location}) in the placement state. This usually ` +
        "means a worktree was removed outside `ai-flow worktree` without clearing its recorded placement — " +
        "the newly created worktree has been cleaned up; remove the stale entry from the placement state " +
        "file and retry.",
    );
  }

  return {
    location: result.path,
    created: true,
    chainId,
    label,
    parallelTo: { chainId: occupyingChainId, location: occupyingEntry.location },
  };
}

module.exports = {
  gitCommonDir,
  placementStatePath,
  readPlacementState,
  claimChainIfPossible,
  decidePlacement,
};
