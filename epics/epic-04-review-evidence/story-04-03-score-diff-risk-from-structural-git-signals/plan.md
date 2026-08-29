# Story 04-03 — Plan

## Implementation Context

- **Execution mode**: STANDARD.
- **Scout pre-step**: no — anchors below are already precise; independent of
  story-04-01/04-02's files.
- **Likely files**:
  - `bin/lib/harness.js` — `scoreDiffRisk` (~line 590) and
    `defaultHighRiskPaths` (~line 129) are the functions to extend: add a
    structural-signal pass alongside the existing `matchesPattern`
    path-pattern loop, over the same `changedFiles` input.
  - `scripts/check-lock-exit-reachability.js` (new) — the deterministic
    check, dependency-free (matching `worktree.js`'s own "zero dependencies"
    constraint), reading changed/tracked `.js` files and flagging a callback
    reachable from `withFileLock(...)` that can reach `fail(`/`process.exit(`
    without an intervening `try`/`throw`.
  - `.coding-flow/config.json` — add the new script to `validation.quality`
    (currently `[]`), so `ai-flow verify` runs it like any other declared
    check (`harness.js` ~line 1099-1105 already merges `validation.commands`
    and `validation.quality` into one executed, captured list).
  - `docs/DOGFOODING.md` — update the 2026-08-28 row's `Resolution` column.
- **Search anchors**: `matchesPattern` (harness.js, the existing glob-matching
  helper `scoreDiffRisk` already calls — reuse for any new path-shaped
  signal, do not reimplement); `changedFilesForCoverage` (harness.js, the
  existing diff-file-list source `scoreDiffRisk` is already fed from).
- **Areas to avoid**: `verifyStoryOnce`'s own command-execution loop
  (harness.js) — the new check is declared data (a `validation.quality`
  entry), not a change to how `verify` executes declared commands.

## Technical Notes

- The structural-signal pass is a bounded, explicitly-scoped text/regex scan
  over each changed file's added lines (from the same diff `scoreDiffRisk`
  already has access to via `changedFilesForCoverage`), not a full AST parse
  — looking for specific call shapes (`git(...[...\"worktree\", \"remove\"...`,
  `git(...[...\"branch\", \"-D\"...`, an unguarded `git(...[...\"merge\"...`)
  with no adjacent `allowFail`/conditional guard on the same or an immediately
  following line. False negatives (a disguised or refactored call shape) are
  acceptable; false positives on an already-guarded call are not, since a
  wrongly `high`-scored quiet change would waste review budget the tier is
  supposed to protect.
- The `check-lock-exit-reachability.js` script performs the same kind of
  bounded scan, scoped specifically to this project's own `withFileLock(`
  call sites: for each, walk the callback body's own text for a call to
  `fail(` (this project's `process.exit`-calling helper) not preceded, within
  the same block, by a `try {` that wraps it — a heuristic, not a full
  control-flow analysis, but one tuned to the exact shape of the real bug
  found on story-03-02 (an unconverted `git()` default-path call inside a
  locked callback).

## Decisions

- **A bounded regex/text-shape heuristic, not an AST-based checker.** A real
  points-to/control-flow analysis was considered and rejected as overkill for
  one project's one naming convention (`withFileLock`/`fail()`) — RULES.md's
  "avoid speculative abstractions" applies here: build the check the actual,
  already-occurred bug needs, not a general framework for a class of bugs
  that has occurred once. If the heuristic proves too noisy or too blind in
  practice, tightening it is cheap; a general engine built up front on one
  data point would not have been.
- **Ships as this project's own `validation.quality` entry, not a new
  built-in gate.** Every other project-declared quality check already works
  this way (RULES.md: "declare them in `.coding-flow/config.json` under
  `validation.quality`... so they are executed and captured, not asserted");
  this story dogfoods that existing mechanism on coding-flow itself rather
  than adding a second way to declare a check.

## Test Plan

- `test/harness-risk.test.js` (new or extended, matching wherever
  `scoreDiffRisk`'s own existing tests live): a diff adding an unconditional
  `git worktree remove`/`git branch -D` call scores at least `medium`, names
  the signal; a diff touching only test/doc files does not trigger it; an
  already-`allowFail`-guarded call does not trigger it (false-positive guard).
- `test/check-lock-exit-reachability.test.js` (new, or a plain script-level
  fixture test): a regression fixture reproducing `landCleanup`'s pre-fix
  shape (the unconverted `git(root, ["worktree", "remove", ...])` calls) fails
  the check; the current, fixed `worktree.js` passes it clean — confirmed by
  running the check directly against both.
- `npm test` — the new `validation.quality` entry runs as part of this
  project's own `ai-flow verify`, dogfooding it live.

## Acceptance Traceability

| Criterion | Test |
|---|---|
| Unconditional git-mutation call raises risk with a named reason | `test/harness-risk.test.js` — structural signal, positive case |
| Test/doc-only diff does not trigger it | same file — structural signal, negative case |
| Already-guarded call does not false-positive | same file — structural signal, guarded case |
| Check fails on the real pre-fix `landCleanup` shape | `test/check-lock-exit-reachability.test.js` — regression fixture |
| Check passes clean on the current, fixed `worktree.js` | same file — no false positive on the real fix |

## Commands

```bash
npm test
node scripts/check-lock-exit-reachability.js
```
