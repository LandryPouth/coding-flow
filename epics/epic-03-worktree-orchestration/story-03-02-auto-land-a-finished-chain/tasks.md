# Story 03-02 — Tasks

- [x] Read `worktree.js`'s `worktreeLand`/`landCleanup` and `audit.js`'s
      `latestVerifyByStoryDir`/`isStale` (targeted discovery — reuse, do not
      redefine "verified").
- [x] Add a "chain's last not-yet-done story" query over story-03-01's
      dependency graph, with unit tests (chain with an open sibling blocks;
      chain with all done triggers).
- [x] Wire the post-completion check into wherever a story's `verified`
      state becomes known (`skills/flow-run/SKILL.md`'s completion step, or
      the module it calls) — automatically invoke `worktree land` when the
      check passes.
- [x] Extend `landCleanup` (or wrap it) to remove the parent
      `<repo>-worktrees/` directory when empty, checked at removal time.
- [x] Clear the landed chain's entry in story-03-01's placement state on
      success; leave it untouched on failure.
- [x] Run `npm test`; capture the verify.

## Status: done

## Result

**`bin/lib/placement-store.js`** (new) — the placement JSON's storage, lock,
and claim primitives, extracted out of story-03-01's `worktree-plan.js`
unchanged in behavior (`gitCommonDir`, `placementStatePath`,
`readPlacementState`, `withPlacementLock`, `claimChainIfPossible`), plus a new
`clearChainPlacement(cwd, epicName, chainId)`. Extracted specifically so
`worktree.js` can require it directly: `worktree-plan.js` already requires
`worktree.js` (for `worktreeAdd`), so `worktree.js` requiring
`worktree-plan.js` back would be circular; `placement-store.js` and
`backbone.js` are leaves neither of the other two files requires, so both
`worktree.js` and `worktree-plan.js` can depend on them safely. All of
`worktree-plan.js`'s 18 existing tests (story-03-01) pass unchanged against
the extracted module — same behavior, moved location.

**`bin/lib/worktree.js`** — `landCleanup` now takes the `{ epic, story }`
pair `findStoryForBranch` already resolves (moved earlier so both the
already-landed and the normal path share one lookup) and, on every
successful land — manual or automatic — (1) removes the parent
`<repo>-worktrees/` directory when it is empty at the moment of removal (not
a count taken earlier, so two chains landing near the same moment do not
race on it), and (2) clears the landed chain's placement entry via
`placement-store.js`, computing the chain id with `backbone.js`'s
`parseBackbone`/`labelForDir` against the landed story's own epic. Both are
best-effort and swallow their own errors: a land that already merged and
removed the worktree must not be reported as failed over parent-directory or
placement-state bookkeeping. Applied to **every** land, not only the new
automatic path — a chain landed by hand must not leave a stale placement
entry either, or a later `worktree place` for the same chain would recommend
a location that no longer exists.

**`bin/lib/worktree-plan.js`** — `resolveStoryChain` (new, shared) factors
out the "parse the epic's backbone, resolve one story to its chain, fail
loudly if either is missing" logic `decidePlacement` already had, now reused
by the new `chainIsFinished`/`autoLandIfChainFinished`.
`chainIsFinished(cwd, epicPath, chainIdOf, storyDirs, chainId)` checks every
label sharing `chainId`: each must be `done`/`verified` in `storage`'s own
derived status AND have a green, non-stale captured verify (the same two
signals `next.js`'s own tier-4 "ready-to-ship" check reads, not redefined
here since `next.js` is a CLI aggregator, not something to import as a
library). `autoLandIfChainFinished({ cwd, epicPath, storyPath })`: if the
chain is not finished, no-op (`reason: "chain-not-finished"`); if the chain's
current location (`cwd`, since this always runs from wherever the chain's own
work happened) equals the repository's main worktree
(`path.dirname(gitCommonDir(cwd))`, resolvable from any worktree), no-op
(`reason: "not-isolated"` — the chain never left the primary checkout, so
there is nothing to land); otherwise, land it.

**Design decision worth recording**: landing is **not** called in-process via
a direct `worktreeLand(name, { cwd: mainRoot })` call, even though
`worktree.js` could export it. `land`'s post-merge re-verify
(`harness.js`'s `verifyStoryOnce`/`writeVerifyEvidence`) reads `context.js`'s
own module-level `cwd`, resolved once from the real OS `process.cwd()` —
independent of any `cwd` object threaded through function parameters.
`autoLandIfChainFinished` always runs from a process whose actual working
directory is the chain's own worktree (that is where `/flow-run` runs this
step from, right after marking the story done there), not the main checkout.
Verified directly: an in-process call with an overridden `cwd` merged and
rebased correctly (its own explicit `git(root, [...])` calls all honored the
override), but the re-verify's evidence file landed inside the worktree that
call was about to delete, and `git worktree remove` then failed with
"contains untracked files" — the worktree was never actually clean by the
time cleanup ran. Fixed by spawning `ai-flow worktree land <name>` as a real
child process (`execFileSync`) with its OS `cwd` genuinely set to the main
checkout, so every part of `land` — not only its explicit git calls — agrees
on where "here" is. On failure, the child's own stdout+stderr become the
thrown error's message unchanged, so a caller sees exactly what a manually
run `land` would have reported.

**`bin/ai-flow.js`** — new `ai-flow worktree autoland --epic <dir> --story
<dir> [--json]`, wired directly here (same reason as `place`: routing through
`worktreeCommand`/`worktree.js` would be circular, since
`autoLandIfChainFinished` calls back into a `worktree land` process).

**`templates/.claude/skills/flow-run/SKILL.md`** (source of truth, synced to
`skills/flow-run/SKILL.md`) — immediately after writing `## Status: done` and
running `worktree unlock` (the existing "Status From Proof" step), a new
instruction runs `ai-flow worktree autoland --epic <epic-dir> --story
<story-dir>` and reports what it did: landed, not-yet-finished (normal, a
sibling is still open), never isolated (normal, the chain ran in the primary
checkout all along), or a land failure (stop and report, same as any other
`land` failure).

**Scoping decision, matching story-03-01's own**: `autoLandIfChainFinished`
targets the repository's main worktree unconditionally — the two-tier model
this epic actually builds (one primary checkout, each parallel chain in its
own worktree off of it), not a general nested-worktree solution. Documented,
not silently assumed, the same way `decidePlacement`'s multi-install guard is.

**Tests**: `test/worktree-autoland.test.js` (new), 5 tests covering all six
acceptance criteria (the two "sibling untouched" criteria share one test —
parent directory kept, sibling worktree kept, both from the same land):
last-story-lands-and-cleans-up, empty-parent-dir-removed (same test),
sibling-worktree-untouched, not-yet-finished-chain-blocks-land,
never-isolated-chain-is-a-no-op, and failed-re-verify-rolls-back
(placement entry, worktree, and branch all left untouched — mirrors
`worktree.test.js`'s own existing land-rollback test). `npm test`: 540/540
green (was 535/535 before this story).

**Post-review fixes (`/flow-review`, 2026-08-28)**:

- An independent adversarial subagent review (given the artifact and the
  spec's contract only, not this session's own reasoning) found and
  reproduced a real gap: `autoLandIfChainFinished`
  (`bin/lib/worktree-plan.js`) derived `chainId` from `--epic`/`--story` but
  never confirmed `cwd` actually corresponds to that chain — it decided
  "isolated" purely from `cwd` vs. the main worktree, and picked *which*
  worktree to land purely from `path.basename(cwd)`, trusting that whatever
  directory the call happened to run from was the chain named in `--story`.
  Reproduced concretely: calling `autoland` for a finished chain A (never
  isolated) from inside a *different*, also-finished chain B's own worktree
  landed chain B — merging and deleting its worktree — while reporting
  `chainId: "s1"` (chain A) as what landed, and silently clearing chain B's
  own placement entry as a side effect. Not reliably caught downstream:
  `worktree land`'s own verify gate validates whatever branch is actually at
  `cwd`, not the chain named in the request, so it only degrades gracefully
  when the mismatched chain happens to be unfinished — exactly the state
  autoland is *not* in when it fires for real. This is the same
  silent-wrong-action failure mode epic-03 exists to prevent (the bethl
  epic-18/19 incidents in `docs/DOGFOODING.md`), on the landing side instead
  of the placement side.
  Fixed: before proceeding past the "not-isolated" check,
  `autoLandIfChainFinished` now looks up `chainId`'s entry in the placement
  store (`readPlacementState`, already used elsewhere in this file) and
  requires it to exist and equal `cwd` exactly, throwing loudly on any
  mismatch rather than guessing. Every chain that ever went through
  `worktree place` — which `/flow-run` always calls before any story work,
  including the chain's own — has an entry there, in-place or not, so this
  costs nothing in the intended flow and only fires on the exact mismatch
  the review reproduced.
- New test: `test/worktree-autoland.test.js` gained a direct case (two
  finished chains, `autoland` invoked from chain B's worktree naming chain
  A) — confirmed it reproduces the wrong-land against the pre-fix code
  (asserted red: exits 0, chain B silently landed) before confirming the fix
  makes it fail loudly with neither chain's worktree or placement entry
  touched. `npm test`: 541/541 green (was 540/540).

## Test Exemption

None — new behavior is covered directly (`test/worktree-autoland.test.js`).

### Rollback Notes

- `bin/lib/placement-store.js` is new and additive; nothing outside
  `worktree.js`/`worktree-plan.js` imports it.
- `bin/lib/worktree.js`'s `landCleanup` signature change (`branch` gained a
  fourth `found` argument) has two call sites, both updated in the same
  commit; both new behaviors (parent-dir removal, placement clearing) are
  best-effort and cannot turn a successful land into a failed one.
- `bin/ai-flow.js`'s new `worktree autoland` branch and
  `bin/lib/worktree-plan.js`'s `autoLandIfChainFinished`/`chainIsFinished`/
  `resolveStoryChain` are additive; nothing else calls them yet beyond the
  new SKILL.md step.
- The one live behavior change beyond the new command: every `worktree land`
  (manual included) now also removes an emptied `<repo>-worktrees/` parent
  directory and clears the landed chain's placement entry. Both are
  best-effort no-ops when there is nothing to clean up (no parent dir, no
  placement entry), so an existing caller with no placement state at all is
  unaffected.
- Reverting `templates/.claude/skills/flow-run/SKILL.md`'s new paragraph (and
  re-running `ai-flow plugin sync`) restores the old manual-land-only flow
  with no other code change required.
