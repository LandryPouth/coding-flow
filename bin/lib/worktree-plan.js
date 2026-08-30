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
const {
  readHarnessConfig,
  changedFilesForCoverage,
  readStoryBundle,
  scoreStoryRisk,
  scoreDiffRisk,
  combineRisk,
} = require("./harness");
const { computeReviewStatus } = require("./status");

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

// `worktree land`'s own precondition always checks freshness for the story
// matching the WORKTREE'S OWN NAME (`findStoryForBranch`, keyed off the
// branch/worktree name) — and that name is always the chain's ROOT story
// (`worktreeAdd` names the worktree/branch after whichever story first
// claimed the chain, in `decidePlacement`). Resolves that root story's own
// project-relative path, the same shape `storage.listEpics()` already
// returns, or null if the worktree name matches no known story (defensive
// only — unreachable in the normal flow, since this only runs after
// `resolveStoryChain` already confirmed the chain and its members exist).
//
// Deliberately not a call to `findStoryForBranch` itself (worktree.js):
// that helper is not exported (it is `worktree.js`-internal), and it
// searches every epic for a name match rather than the one epic this call
// already knows it is in — scoping here to `epicName` is strictly more
// precise, since a same-named story directory in a different epic would
// otherwise resolve to the wrong root. It also skips `findStoryForBranch`'s
// own best-effort try/catch around the storage read (there, a transient
// read failure degrades to "not linked to a known story" rather than
// blocking `land`; here it surfaces as an uncaught error) — acceptable
// since this only ever runs after `resolveStoryChain` has already proven
// the epic and chain are readable moments earlier in the same call.
function findRootStoryPath(cwd, epicName, worktreeName) {
  const config = readConfig(cwd);
  const epic = getStorage(cwd, config)
    .listEpics()
    .find((e) => e.name === epicName);
  if (!epic) return null;
  const story = epic.stories.find((s) => s.name === worktreeName);
  return story ? story.path : null;
}

// A story counts toward "chain finished" the same way `next.js`'s own
// tier-4 ("ready-to-ship") check reads it: an explicit `done`/`verified`
// status AND a captured verify that was green at some point — a written
// status alone is not proof (see next.js's `storyProof`, reused here in
// shape, not imported, since `next.js` is a CLI aggregator, not a library
// dependency).
//
// Deliberately NOT checked here: whether that verify is still *fresh*
// against the tree right now. All of a chain's stories share one
// worktree/branch, and `flow-run` always writes `## Status: done` as its own
// commit AFTER the verify it is based on (skills/flow-run/SKILL.md's own
// mandated order) — so by design, the tree always moves past a story's own
// verify before that story is done, for every story, chained or not. A
// static token comparison here would flag every finished chain as
// unfinished, always. Freshness is a real requirement, but it belongs at
// the one place it can be answered honestly: `autoLandIfChainFinished`
// re-verifies the chain's root story against the CURRENT tree, right before
// calling `land` — an actual re-run, not a stale comparison — and `land`'s
// own precondition (epic-02, unchanged) is the hard gate that rejects
// anything that re-run does not cover.
// story-04-02: a chain finishing is not only "every member done + green verify"
// once any member's own risk tier resolves to STRICT (`combineRisk(...).level
// === "high"`, computed the exact way `buildHarnessPreflight` already does —
// never a second, independent risk model). That member also needs a fresh,
// passing review evidence entry (story-04-01's `computeReviewStatus`, the
// same "pass"/"stale"/"fail"/"none" states `ai-flow status` already surfaces).
// QUICK/STANDARD members are unaffected — the pre-existing done/verified +
// green-verify check is still the only one applied to them.
//
// The diff-risk half of the score is computed ONCE per chain (`changedFilesForCoverage`
// reads the whole worktree's current diff against its base branch — every
// member of a chain shares that one worktree/branch, so the diff is the same
// input `ai-flow harness preflight` would see run from here right now), not
// once per member; only the story-text half differs member to member.
function reviewGateReason(cwd, story) {
  const state = computeReviewStatus(cwd, story.path);

  if (state === "none") return "review-missing";
  if (state === "stale") return "review-stale";
  if (state === "fail") return "review-failed";
  return null;
}

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
    return { finished: false, reason: "chain-not-finished" };
  }

  const storyByName = new Map(epic.stories.map((story) => [story.name, story]));
  const verifyByDir = latestVerifyByStoryDir(cwd);
  const { config: harnessConfig } = readHarnessConfig(cwd);
  const diffFiles = changedFilesForCoverage(cwd);
  const diffRisk = scoreDiffRisk(diffFiles, harnessConfig, cwd);

  for (const [label, id] of chainIdOf.entries()) {
    if (id !== chainId) continue;

    const dirName = dirForLabel(storyDirs, label);
    const story = storyByName.get(dirName);
    // Both directions are already validated by `parseBackbone` before
    // `chainIdOf` exists — a member with no matching story here would mean
    // `storage` and the backbone disagree about what's in `## Stories`,
    // not a real gap; treat as not-finished rather than guessing.
    if (!story) return { finished: false, reason: "chain-not-finished" };

    const claimsDone = story.status === "done" || story.status === "verified";
    if (!claimsDone) return { finished: false, reason: "chain-not-finished" };

    const verifyEntry = verifyByDir.get(story.path);
    if (!verifyEntry || verifyEntry.ok !== true) return { finished: false, reason: "chain-not-finished" };

    const storyText = Object.values(readStoryBundle(path.join(cwd, story.path))).join("\n");
    const risk = combineRisk(scoreStoryRisk(storyText, harnessConfig), diffRisk);

    if (risk.level === "high") {
      const reason = reviewGateReason(cwd, story);
      if (reason) {
        return { finished: false, reason, story: story.path };
      }
    }
  }

  return { finished: true, reason: null };
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

  const finishState = chainIsFinished(cwd, epicPath, chainIdOf, storyDirs, chainId);
  if (!finishState.finished) {
    return { landed: false, reason: finishState.reason, chainId, ...(finishState.story ? { story: finishState.story } : {}) };
  }

  const worktreeName = path.basename(here);
  const cliPath = path.join(__dirname, "..", "ai-flow.js");

  // `chainIsFinished` above only requires the chain's most recently captured
  // verify to be fresh — correct for deciding "is this chain done" (see its
  // own comment), but `worktree land`'s own precondition (epic-02, reused
  // exactly as-is) checks freshness for the ROOT story specifically, and the
  // root's own verify predates every dependent's later commits in any real
  // multi-story chain — in fact it predates flow-run's own mandated
  // `## Status: done` commit (written right after the verify it is based on,
  // for every story, chained or not — SKILL.md's "Status From Proof"), so
  // this branch fires on essentially every real land, not only multi-story
  // ones. Not a bug in `land` to work around by redefining its contract (out
  // of scope per spec.md) — the honest fix is to actually refresh the root's
  // own evidence before calling `land`, the same command a human would run
  // by hand (`ai-flow verify --story <root>`).
  const rootStoryPath = findRootStoryPath(cwd, epicName, worktreeName);
  if (rootStoryPath) {
    const verifyByDir = latestVerifyByStoryDir(cwd);
    const rootEntry = verifyByDir.get(rootStoryPath);
    const currentToken = currentTreeToken(cwd);

    if (!rootEntry || isStale(rootEntry, currentToken)) {
      try {
        execFileSync(process.execPath, [cliPath, "verify", "--story", rootStoryPath], {
          cwd: here,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (err) {
        const message = `${err.stdout || ""}${err.stderr || ""}`.trim() || err.message;
        throw new Error(
          `worktree autoland: re-verifying chain root "${rootStoryPath}" before landing failed: ${message}`,
        );
      }

      // `land`'s own dirty-tree check (`realDirtyLines`, `git status
      // --porcelain`) would otherwise refuse to land the freshly-written
      // evidence file as an uncommitted change — but only when
      // `.coding-flow/runs/` is NOT gitignored: `git status --porcelain`
      // never lists ignored paths in the first place, so there is nothing to
      // stage or commit when it is (this project's own root `.gitignore` has
      // excluded it since the repo's first commit, and neither
      // `writeVerifyEvidence` (harness.js) nor anything else in this
      // codebase ever commits it — a real, ephemeral, non-source directory,
      // per `ci.js`'s artifact upload and `identity.js`'s tree-token
      // exclusion). Checking with `git check-ignore` first — rather than
      // just attempting `git add` and swallowing any failure — because
      // `git add` on an explicitly-named, fully-ignored path exits non-zero
      // for that reason specifically (confirmed: exit 1, "The following
      // paths are ignored"), and swallowing every failure there would just
      // as easily hide a real one (disk full, permissions).
      let pathIsIgnored = true;
      try {
        execFileSync("git", ["check-ignore", "-q", "--", ".coding-flow/runs"], { cwd: here, stdio: "ignore" });
      } catch (err) {
        if (err.status !== 1) throw err;
        pathIsIgnored = false;
      }

      if (!pathIsIgnored) {
        // Staged narrowly (never `-A`): this step's own job is committing
        // the refreshed evidence, nothing else — an unrelated untracked
        // file sitting in the worktree at this exact moment must never ride
        // along into a commit nobody reviewed, the same reasoning
        // `ship.js`'s `autoCommitDirtyTree` scans for secrets before its own
        // auto-commit, just enforced here by never widening the `add`.
        execFileSync("git", ["add", "--", ".coding-flow/runs"], { cwd: here, stdio: "ignore" });

        // A no-op in the rare case `verify`'s own reusable-proof cache
        // (`findReusableVerify` in harness.js) answered from an older
        // evidence file that already matched the current tree without
        // writing a new one.
        const staged = execFileSync("git", ["status", "--porcelain", "--", ".coding-flow/runs"], {
          cwd: here,
          encoding: "utf8",
        }).trim();

        if (staged) {
          // Wrapped like the re-verify call above (and unlike `add`/
          // `check-ignore`, which only fail in ways already handled): a
          // project-local `pre-commit` hook (lint-staged, commitlint, a
          // secrets scan) can reject even this narrow, evidence-only commit,
          // and an uncaught `execFileSync` failure here would surface as a
          // raw "Command failed" message instead of one of this function's
          // otherwise consistently actionable errors.
          try {
            execFileSync("git", ["commit", "-m", `chore: refresh verify for ${rootStoryPath} before auto-land`], {
              cwd: here,
              stdio: ["ignore", "pipe", "pipe"],
            });
          } catch (err) {
            const message = `${err.stdout || ""}${err.stderr || ""}`.trim() || err.message;
            throw new Error(
              `worktree autoland: committing the refreshed verify for chain root "${rootStoryPath}" failed: ${message}`,
            );
          }
        }
      }
    }
  }

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
