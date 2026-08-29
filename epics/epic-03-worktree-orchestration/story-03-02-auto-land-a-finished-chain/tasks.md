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

**Post-review fixes (`/flow-review`, 2026-08-29)**:

- A second `/flow-review` pass, reviewing the artifact against the story's
  contract (not this session's own reasoning), found and reproduced a P0:
  `chainIsFinished` compared every chain member's own captured verify
  `treeToken` against ONE shared `currentToken` computed once, at check
  time. All of a chain's stories share one worktree/branch, so by the time
  the chain's last member finishes, every earlier member's own token
  necessarily predates that later member's own commits — legitimate chain
  progression, not drift. Reproduced directly (a minimal two-commit repo,
  outside any test fixture): comparing an earlier token against a later one
  after a real, unrelated file commit returned `isStale: true`. Consequence:
  auto-land could never fire for a real (non-toy) multi-story chain — it
  silently no-opped forever, reporting `chain-not-finished`. Not caught by
  `test/worktree-autoland.test.js` because its `writeVerify` fixture only
  ever committed under `.coding-flow/runs/`, which `computeTreeToken`
  deliberately excludes — so no test ever moved the token between two
  members' verify captures.
- Fixing just that exposed a second, deeper issue while proving the fix
  against `flow-run`'s actual documented sequence (`SKILL.md`'s "Status From
  Proof": verify captured, `## Status: done` written as its own commit
  right after — for every story, chained or not): `worktree land`'s own
  precondition (epic-02, unchanged) checks freshness only for the story
  matching the worktree's own name, which is always the chain's ROOT story
  (`worktreeAdd` names the worktree/branch after whichever story first
  claimed the chain). The root's own verify predates every dependent's
  later work by construction, so `land` refused with "stale" even after
  `chainIsFinished` correctly recognized the chain as done — and, further
  up, even a **single**-story chain tripped the same shared-token gate
  inside `chainIsFinished` itself, since flow-run's own mandated
  `## Status: done` commit lands after the verify it is based on, moving
  the tree past it every time, chain or no chain.
  Fixed in two parts, confirmed against real single- and multi-story
  reproductions before touching the test suite:
  1. `chainIsFinished` no longer compares any verify's token against the
     current tree at all — it only requires each member to claim
     done/verified and to have been green at some point. Freshness is a
     real requirement, but a static comparison here cannot express it
     correctly given flow-run's own write order; enforcing it here was
     always going to reject a legitimately finished chain.
  2. `autoLandIfChainFinished` now honestly re-verifies the chain's root
     story (`ai-flow verify --story <root>`, a real command re-run, not a
     synthesized pass) against the current tree immediately before calling
     `land`, but only when the root's own recorded verify is missing or
     stale — a single-story chain's own verify is already the most recent
     thing that happened, so this is a no-op there. The refreshed evidence
     is committed (`.coding-flow/runs/*.json` is tracked content) so
     `land`'s own dirty-tree check does not itself refuse. `land`'s
     ff-only/rebase/re-verify/rollback contract is still reused exactly
     as-is, per spec.md — this only feeds it an honest, current precondition
     instead of redefining it.
- `test/worktree-autoland.test.js`'s "last story of a worktree'd chain
  lands..." test now mirrors flow-run's real order (verify, then
  `## Status: done` as its own commit, for both chain members, with real
  code work for the second member landing in between) rather than the
  looser sequence that had masked both gaps. `npm test`: 541/541 green
  (was 541/541 before — same count, stronger coverage: the existing test
  now exercises the real ordering instead of one that happened to avoid
  both bugs).

**Second `/flow-review` pass (2026-08-29)**, reviewing the artifact (the diff
above) against the contract (spec.md, plan.md, RULES.md) rather than this
session's own reasoning about it:

- The refresh-and-commit step staged with `git add -A` before committing the
  refreshed root evidence — broader than its own stated job (committing one
  evidence file so `land`'s dirty-tree check does not refuse). Compared
  against this codebase's only other automatic-commit path
  (`ship.js`'s `autoCommitDirtyTree`, which explicitly runs a secret/
  sensitive-file scan before ever staging, because "an automatic commit must
  never be the thing that leaks a credential a human would have caught in
  review"), this step had no equivalent guard and would have silently swept
  any unrelated untracked, non-gitignored file sitting in the worktree at
  that moment into the auto-land commit. Fixed by narrowing the stage to
  `git add -- .coding-flow/runs` — the only path this step is ever meant to
  touch — and skipping the commit entirely when nothing is actually staged
  afterward (the rare case where `verify`'s own reusable-proof cache
  answered from an already-matching evidence file without writing a new
  one).
- `bin/lib/worktree-plan.js`'s `findRootStoryPath` duplicates `worktree.js`'s
  `findStoryForBranch` (not exported, hence the duplication) without its
  best-effort try/catch around the storage read. Left as-is — the epic-name
  scoping here is more precise than a global search, and this only ever runs
  moments after `resolveStoryChain` has already proven the epic is
  readable — but documented in-place so the divergence reads as deliberate,
  not an oversight.
- plan.md's own Decisions/Technical Notes still described the pre-fix design
  ("reuses `land`'s preconditions... unchanged; does not duplicate or
  re-check them"), which the first post-review fix (above) had already
  contradicted by adding the root re-verify-and-commit step. Updated to
  describe what the code actually does now — RULES.md requires meaningful
  architecture decisions to live in the story's plan Decisions section, and
  a reader opening plan.md for "why does this call verify at all" was
  getting the old, wrong answer.
- Test gap: no test exercised a failure *inside* the new root-refresh step
  itself (only `land`'s own pre-existing post-merge re-verify failure,
  epic-02, was covered). Added
  `test/worktree-autoland.test.js`'s "a failed re-verify of a stale chain
  root fails before land ever runs..." test — same stale-root shape as the
  "lands" test above, but with a command that always fails, asserting the
  worktree/branch/placement entry are all untouched and `land` is never
  reached. Confirmed red against the pre-fix code (reverting the root-refresh
  block fails both this new test and the earlier "lands" test, 5/7), green
  after. `npm test`: 542/542 (was 541/541 — one new test, no regressions).

**Third `/flow-review` pass (2026-08-29)**, this time explicitly given the
artifact and the contract only (spec.md, this repo's own `.gitignore`) rather
than the session's own reasoning about it — found and reproduced a P0 the
first two passes missed:

- The refresh step's `git add -- .coding-flow/runs` crashed with an uncaught
  error on this project's own repository. `.coding-flow/runs/` has been
  gitignored in this repo's root `.gitignore` since its very first commit,
  `harness.js`'s `writeVerifyEvidence` never commits evidence anywhere in this
  codebase, and `ci.js` uploads the directory as a CI artifact — it is real,
  ephemeral, non-source content, not "tracked, not gitignored" as the
  pre-fix comment claimed (that claim cited a `worktree.js` convention that
  turned out not to exist). `git add` on an explicitly-named, fully-ignored
  path exits non-zero without `-f`, and the call was not wrapped in a
  try/catch, so the whole `autoLandIfChainFinished` call died with a bare
  `Error: Command failed: git add -- .coding-flow/runs`. Reproduced end-to-end
  against the real CLI (real `ai-flow verify` runs, not the test suite's own
  hand-written-and-committed evidence fixture, against a repo carrying this
  project's actual `.gitignore`): a two-story chain following flow-run's real
  write order (verify, then `## Status: done` as its own commit) always makes
  the root's recorded verify stale by the time the chain finishes — so this
  is not an edge case, it is the normal path, and auto-land was broken for
  this project's own dogfooding.
  Fixed in two steps: first attempted removing the commit entirely (evidence
  freshness is read straight off disk by `latestVerifyByStoryDir` regardless
  of git tracking, so it seemed unnecessary) — this broke the *existing*
  "lands and removes the worktree directory" test, because when
  `.coding-flow/runs/` is genuinely NOT gitignored, the freshly-written
  evidence file is a real untracked file and `land`'s own dirty-tree check
  (`git status --porcelain`) does list it, refusing the land. The correct fix
  checks which case applies first (`git check-ignore -q --
  .coding-flow/runs`, not swallowing every `git add` failure indiscriminately
  since that would just as easily hide a real one): commit narrowly
  (`git add -- .coding-flow/runs`, never `-A`) when the path is not ignored,
  skip the commit entirely when it is — `land`'s own check never saw an
  ignored file as dirty to begin with, so nothing needs staging there either
  way.
- New test: `test/worktree-autoland.test.js` gained a dedicated regression
  case using a `.gitignore` matching this project's own convention and real
  `ai-flow verify` runs (not the fixture's own hand-written evidence, which
  only worked because no test repo shipped a `.gitignore`) — confirmed this
  reproduces the crash against the pre-fix code before confirming the fix
  lands cleanly. `npm test`: 543/543 (was 542/542 — one new test, no
  regressions, including the pre-existing non-gitignored "lands" test that
  the first fix attempt broke).
- plan.md's Technical Notes corrected: it previously claimed the refresh was
  "a no-op for a single-story chain" — false, per the reproduction above (the
  mandated status commit alone stales the root's own verify, single-story or
  not) — and described the commit step as unconditional, missing the
  gitignored case entirely.

**Fourth `/flow-review` pass (2026-08-29)**, reviewing the artifact and the
contract (spec.md, plan.md, RULES.md) rather than the session's own reasoning
— found and fixed a P1 the first three passes missed, entirely on the landing
side rather than the placement or freshness side already covered:

- `worktreeLand` (`bin/lib/worktree.js`) ran its whole
  merge/rebase/reset/post-merge-validation sequence directly against the
  shared main checkout with no serialization at all. Two chains auto-landing
  near the same moment — the exact scenario this epic exists to enable,
  parallel chains finishing independently — could interleave destructively on
  that one working directory: `verifyStoryOnce`'s real validation commands run
  against `context.js`'s module-level `cwd` (resolved once from the real OS
  `process.cwd()`, independent of any parameter — the same fact plan.md's own
  "Design decision" section already used to justify spawning `land` as a
  subprocess), so one land's in-flight test run could read a half-merged tree,
  or one's `git reset --hard` on a failed re-verify could yank files out from
  under another's concurrent read. `placement-store.js` already took a real
  filesystem lock for its own, much lower-stakes JSON read/write; the actual
  git mutation of the shared checkout had no equivalent, and spec.md's only
  documented concurrency edge case named the (far less severe) parent-directory
  removal race, not this one.
  Fixed by extracting `placement-store.js`'s lock primitive into a general
  `withFileLock(lockPath, fn, { waitTimeoutMs, staleMs })` and wrapping
  `worktreeLand`'s mutating section in it, scoped by `git-common-dir` so the
  same lock file applies from any of the repo's worktrees. Timeouts are not
  the placement store's own 5s/30s defaults — `land`'s critical section runs a
  real, unbounded validation command, so both are generous (10 minutes to
  wait, 15 before a held lock is considered abandoned) rather than tuned,
  since waiting too long costs far less than racing the checkout again. See
  plan.md's Decisions for the full writeup, including the `fail()`/
  `process.exit()` interaction this fix had to account for: `fail()`
  terminates before `withFileLock`'s own `finally` (the lock release) can run,
  and `land` calls `fail()` on nearly every one of its own ordinary failure
  paths — so every `fail()` call inside the locked section was converted to a
  thrown `Error` instead (a real exception unwinds normally, releasing the
  lock before the message reaches the caller), with one `try/catch` around the
  whole locked call translating back to `fail(err.message)` afterward. Every
  existing test's expected failure text is unchanged.
- New test: `test/worktree.test.js` gained "worktree land waits for the
  shared land lock instead of racing a concurrent holder" — a real background
  OS process pre-acquires the exact lock file `land` now takes, holds it for a
  known duration, and the test asserts `land` waited at least that long rather
  than proceeding immediately. Confirmed red against the pre-fix code
  (temporarily reverted `worktree.js`/`placement-store.js`, kept the new test:
  failed with "waited 581ms, held 800ms") before confirming it passes with the
  fix restored. `npm test`: 544/544 (was 543/543 — one new test, no
  regressions, including "retried after a rollback, lands cleanly", the
  existing test most likely to have caught a lock-leak regression).
- spec.md's Concurrency edge case extended to name this race explicitly
  (previously only covered the parent-directory removal race), per RULES.md's
  requirement to record unresolved risk rather than leave it undocumented.

**Fifth `/flow-review` pass (2026-08-29)**, two non-blocking improvements from
a pass that also ran the full suite itself and confirmed it green:

- `withFileLock`'s stale-lock-reclaim branch (`bin/lib/placement-store.js`,
  the `Date.now() - stat.mtimeMs > staleMs` check) had zero test coverage
  anywhere in the suite, for either its original placement-JSON use
  (story-03-01) or this story's new one — and this story raises the stakes of
  that branch considerably, since it now decides whether `land`'s real
  merge/rebase/reset against the shared main checkout gets interrupted by a
  second concurrent land. New `test/placement-store.test.js` (new file, 3
  tests): reclaiming a lock file backdated past `staleMs`; NOT reclaiming one
  within its stale window (waits, then times out); and the lock being
  released even when the guarded callback throws (the exact mechanism the
  fourth pass's `fail()`-to-`throw` conversion depends on).
- The root-refresh step's final `git commit` (`bin/lib/worktree-plan.js`) ran
  unguarded, unlike the `check-ignore` call two lines above it — a
  project-local `pre-commit` hook rejecting this narrow, evidence-only commit
  would have surfaced as a raw `execFileSync` "Command failed" message
  instead of one of this function's otherwise consistently actionable
  errors. Wrapped in the same try/catch pattern already used for the
  re-verify call above it. `npm test`: 547/547 (was 544/544 — three new
  tests, no regressions).

**Sixth `/flow-review` pass (2026-08-29)**, given the artifact and the
contract only, found and fixed a P1 the first five passes missed — the same
class of bug as the fourth pass, on a call site that pass's own "two calls"
inventory (plan.md's Decisions) missed:

- `landCleanup` (`bin/lib/worktree.js`) is called from both places inside
  `worktreeLand`'s locked section (the already-landed shortcut and the normal
  success path), but its own `git worktree remove`/`git worktree prune` calls
  still went through the shared `git()` helper's default (non-`allowFail`)
  path — which calls `fail()` → `process.exit()`, exactly the mechanism the
  fourth pass's fix was built to eliminate from that section. Reproduced
  directly: a validation command that drops a stray, unmanaged file into the
  story worktree during the post-merge re-verify (after the pre-lock dirty
  check already passed clean — a real race window this story's own lock
  exists to protect, not a contrived one) makes `git worktree remove` refuse
  ("contains modified or untracked files"), and the lock file is left on disk
  (confirmed with a standalone script showing the lock survives the process
  exit, and end-to-end through the real CLI). Consequence: every later `land`
  — including a concurrent auto-land from another chain, the exact scenario
  this lock exists to serialize — would wait out the full 10-minute timeout
  before the 15-minute stale-reclaim frees it.
  Fixed the same way as every other mutating call in the locked section:
  `{ allowFail: true }` plus a thrown `Error`, worded to make clear the merge
  itself already succeeded (retrying `land` is safe — it takes the
  already-landed shortcut next time).
- New test: `test/worktree.test.js`, "worktree land releases the shared lock
  instead of leaking it when landCleanup's worktree removal fails" —
  confirmed red against the pre-fix code (temporarily reverted
  `worktree.js`, kept the new test: the lock file was left on disk) before
  confirming it passes, and releases the lock, with the fix restored.
  `npm test`: 548/548 (was 547/547 — one new test, no regressions).
- plan.md's Decisions updated: the "two calls" inventory now also accounts
  for `landCleanup`'s two, and records this pass.

**Seventh `/flow-review` pass (2026-08-29)**, a non-blocking finding fixed on
request rather than left for a future story:

- `withFileLock` (`bin/lib/placement-store.js`) had no ownership check on
  release — a still-running holder that outlived `staleMs` (real for `land`'s
  unbounded validation command) could have its lock stolen by a waiter, then
  delete that waiter's active lock out from under it once it finally finished,
  freeing the lock for a third caller while the second was still running. No
  choice of `staleMs`, however generous, removes this — it only lowers the
  odds.
  Fixed with a per-acquisition ownership token: written into the lock file on
  acquire, checked back on release, so `rmSync` only fires when the file still
  holds that same token.
- New test: `test/placement-store.test.js`, "withFileLock does not delete a
  lock stolen from it while it was still (slowly) running" — confirmed red
  against the pre-fix code (temporarily reverted `placement-store.js`, kept
  the new test: the foreground call's lock was deleted out from under it)
  before confirming it passes with the fix restored. `npm test`: 549/549 (was
  548/548 — one new test, no regressions).

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
