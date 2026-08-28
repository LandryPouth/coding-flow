"use strict";

// Decides where a story runs — continuing the location its dependency chain
// already occupies, or opening a new worktree because it starts a new chain
// relative to what is already running — and remembers that decision so a
// later `/flow-run` invocation (a different terminal, a different session)
// reads it instead of re-deriving or re-guessing it.
//
// The state has to be readable from ANY of an epic's worktrees, not just the
// one it happens to be written from — see `placement-store.js`, which owns
// the actual JSON file, its shared location, and the lock that guards
// concurrent claims. This module adds the chain-graph decision on top: which
// chain a requested story belongs to (`backbone.js`) and what to do about it
// (reuse the recorded location, claim here, or open a new worktree via
// `worktree.js`'s `worktreeAdd`).

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const { parseBackbone, labelForDir, dirForLabel } = require("./backbone");
const { worktreeAdd, requireRepo } = require("./worktree");
const {
  gitCommonDir,
  placementStatePath,
  readPlacementState,
  claimChainIfPossible,
} = require("./placement-store");
const { getStorage } = require("./storage");
const { readConfig } = require("./config");
const { latestVerifyByStoryDir, isStale } = require("./audit");
const { currentTreeToken } = require("./identity");

function epicNameFromPath(epicPath) {
  return path.basename(epicPath);
}

// Shared by `decidePlacement` and `autoLandIfChainFinished`: parses the
// epic's backbone and resolves one story to its chain, failing loudly (never
// guessing) when the epic index is missing or the story is not listed — the
// same rule `backbone.js` itself already applies to a malformed tree.
function resolveStoryChain(cwd, epicPath, storyPath) {
  const indexPath = path.join(cwd, epicPath, "index.md");
  if (!fs.existsSync(indexPath)) {
    throw new Error(`epic index not found: ${epicPath}/index.md`);
  }

  const { storyDirs, chainId: chainIdOf } = parseBackbone(fs.readFileSync(indexPath, "utf8"));
  const storyDirName = path.basename(storyPath);
  const label = labelForDir(storyDirs, storyDirName);

  if (!label) {
    throw new Error(`story "${storyDirName}" is not listed in ${epicPath}/index.md's ## Stories`);
  }

  return { storyDirs, chainIdOf, label, chainId: chainIdOf.get(label) };
}

// `cwd` here is the coding-flow *project* root (context.js walks up to the
// nearest `.coding-flow/`, deliberately not the git root — "a repo holding
// several installs" gets its own project root per install). A git worktree
// is inherently a whole-repository concept: `worktreeAdd`/`worktreeLand`
// always operate relative to the *git* root (worktree.js's `worktreeDest`),
// regardless of which project subdirectory asked for it. If the two roots
// ever diverge, "here" (recorded for the in-place case, or compared against
// the main worktree for auto-land) would silently stop being a comparable
// location — fail loudly instead of trusting a decision that cannot be,
// same principle as backbone.js's malformed-tree guard.
function requireProjectRootIsGitRoot(cwd, storyPath) {
  const root = requireRepo(cwd);
  if (path.resolve(root) !== path.resolve(cwd)) {
    throw new Error(
      "worktree placement requires the coding-flow project root to be the git repository root " +
        `(project root "${cwd}" is inside git repo "${root}"). Multi-install monorepos are not supported ` +
        `for automatic placement/land yet — run \`ai-flow worktree land\` manually: ${storyPath}`,
    );
  }
  return root;
}

// `epicPath` and `storyPath` are project-root-relative, the same shape
// `storage.listEpics()` already returns (e.g. `epics/epic-19-.../`,
// `epics/epic-19-.../story-19-01-.../`). Throws when the story is not
// actually listed in the epic's `## Stories` — the same "fail loudly rather
// than guess a placement" rule `backbone.js` already applies to a malformed
// tree.
function decidePlacement({ cwd, epicPath, storyPath }) {
  requireProjectRootIsGitRoot(cwd, storyPath);

  const { chainId, label } = resolveStoryChain(cwd, epicPath, storyPath);
  const storyDirName = path.basename(storyPath);
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

// A story is "verified" for auto-land purposes the same way `next.js`'s own
// tier-4 ("ready-to-ship") check reads it: an explicit `done`/`verified`
// status AND a green, non-stale captured verify for it — a written status
// alone is not proof (see next.js's `storyProof`, reused here in shape, not
// imported, since `next.js` is a CLI aggregator, not a library dependency).
function chainIsFinished(cwd, epicPath, chainIdOf, storyDirs, chainId) {
  const config = readConfig(cwd);
  const epicName = epicNameFromPath(epicPath);
  const epic = getStorage(cwd, config)
    .listEpics()
    .find((e) => e.name === epicName);

  // The epic was just read successfully by `resolveStoryChain` above (its
  // index.md exists and lists the story), so `storage` must see it too —
  // defensive only, never expected to actually be null.
  if (!epic) {
    return false;
  }

  const storyByName = new Map(epic.stories.map((story) => [story.name, story]));
  const verifyByDir = latestVerifyByStoryDir(cwd);
  const currentToken = currentTreeToken(cwd);

  for (const [label, id] of chainIdOf.entries()) {
    if (id !== chainId) continue;

    const dirName = dirForLabel(storyDirs, label);
    const story = storyByName.get(dirName);
    // Both directions are already validated by `parseBackbone` before
    // `chainIdOf` exists — a member with no matching story here would mean
    // `storage` and the backbone disagree about what's in `## Stories`,
    // not a real gap; treat as not-finished rather than guessing.
    if (!story) return false;

    const claimsDone = story.status === "done" || story.status === "verified";
    if (!claimsDone) return false;

    const verifyEntry = verifyByDir.get(story.path);
    if (!verifyEntry || verifyEntry.ok !== true) return false;
    if (isStale(verifyEntry, currentToken)) return false;
  }

  return true;
}

// After a story reaches the derived "verified" state, decide whether that
// finishes its whole chain and, if the chain is running in its own worktree
// (not the primary checkout), land it automatically via the existing
// `worktree land` — reusing epic-02's merge/rebase/re-verify/rollback
// contract exactly as-is; this only decides *when* to call it, the same way
// story-03-01 only decides when to call `worktreeAdd`.
//
// Land must run from the checkout being merged INTO, never from the story's
// own worktree (`worktreeLand`'s own guard) — so this always targets the
// repository's main worktree (`git rev-parse --git-common-dir`'s parent,
// resolvable from any worktree, the same primitive `placement-store.js`
// already relies on), regardless of which worktree this function itself was
// invoked from. Scoped, like `decidePlacement`, to the two-tier model this
// epic actually builds (one primary checkout, chains parallel to it each in
// their own worktree) — not a general nested-worktree solution.
//
// `worktreeLand` is deliberately NOT called in-process here, even though
// `worktree.js` exports the git-plumbing pieces it needs: `land`'s post-merge
// re-verify (`harness.js`'s `verifyStoryOnce`/`writeVerifyEvidence`) reads
// `context.js`'s own module-level `cwd`, resolved once from the real OS
// `process.cwd()` — independent of any `cwd` object threaded through function
// calls. A direct call from a process whose actual working directory is the
// chain's own worktree (which is where `/flow-run` runs this from) would run
// that re-verify, and write its evidence, in the wrong checkout — proven by
// running it that way once and finding the evidence file land inside the
// worktree it was about to delete. Spawning `worktree land` as its own child
// process, with its OS `cwd` genuinely set to the main checkout, is the only
// way every part of `land` (not only its explicit `git()` calls) agrees on
// where "here" is.
function autoLandIfChainFinished({ cwd, epicPath, storyPath }) {
  requireProjectRootIsGitRoot(cwd, storyPath);

  const { storyDirs, chainIdOf, chainId } = resolveStoryChain(cwd, epicPath, storyPath);

  // Checked before scanning every chain member's proof: a chain that never
  // left the primary checkout has nothing to land regardless of whether it
  // is finished, and this is the common case (a linear epic, or the epic's
  // own root chain) — cheaper to rule out first than to pay for a
  // storage/verify scan that can only end up unused.
  const mainRoot = path.dirname(gitCommonDir(cwd));
  const here = path.resolve(cwd);
  if (here === path.resolve(mainRoot)) {
    return { landed: false, reason: "not-isolated", chainId };
  }

  // `cwd` is standing in SOME worktree at this point — but nothing above
  // confirms it is actually the chain named by `--story`. Without this
  // check, a call for one chain's story from a DIFFERENT chain's worktree
  // (a plausible slip driving several parallel worktrees, the exact domain
  // this epic exists for) would silently land whatever is at `cwd` while
  // reporting the unrelated chain's id — the same silent-wrong-action
  // failure mode epic-03 exists to prevent, on the landing side this time.
  // The placement store (story-03-01) is the one authority for "where does
  // this chain actually live" — every chain that ever went through
  // `worktree place` (which `/flow-run` always calls before any story work
  // begins, including this chain's own) has an entry there, in-place or
  // not; cross-check against it and fail loudly on any mismatch rather than
  // trusting `cwd`'s basename as the thing to land.
  const epicName = epicNameFromPath(epicPath);
  const recorded = readPlacementState(cwd, epicName).chains[chainId];
  if (!recorded || path.resolve(recorded.location) !== here) {
    throw new Error(
      `worktree autoland requires running from chain "${chainId}"'s own recorded location, but ` +
        `${recorded ? `it is recorded at "${recorded.location}"` : "no placement is recorded for it"} — ` +
        `this call ran from "${here}". Run it from the chain's own location (or \`worktree place\` it ` +
        "first if you are unsure where that is) rather than guessing.",
    );
  }

  if (!chainIsFinished(cwd, epicPath, chainIdOf, storyDirs, chainId)) {
    return { landed: false, reason: "chain-not-finished", chainId };
  }

  const worktreeName = path.basename(here);
  const cliPath = path.join(__dirname, "..", "ai-flow.js");

  try {
    execFileSync(process.execPath, [cliPath, "worktree", "land", worktreeName], {
      cwd: mainRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    // Bubble land's own message up unchanged — nothing new invented on the
    // failure path, per spec.md. `landCleanup` never ran, so the chain's
    // placement entry, worktree, and branch are exactly as `land` itself
    // already guarantees on a failed attempt.
    const message = `${err.stdout || ""}${err.stderr || ""}`.trim() || err.message;
    throw new Error(message);
  }

  return { landed: true, chainId, worktreeName };
}

module.exports = {
  gitCommonDir,
  placementStatePath,
  readPlacementState,
  claimChainIfPossible,
  decidePlacement,
  autoLandIfChainFinished,
};
