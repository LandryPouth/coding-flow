# Story 07-01 — Plan

## Implementation Context

- **Execution mode**: STRICT.
- **Likely files**:
  - `bin/lib/policy.js` — `defaultBranch` (~29) stays; add
    `resolveDiffBase` beside it (policy.js is already the git-read module
    without side effects).
  - `bin/lib/harness.js` — `addedLinesByFile` (~670), `scoreDiffRisk` (~781,
    callers ~858 and ~2054), `changedFilesForCoverage` (~1620),
    `changedLinesForCoverage` (~1705), `deletedFilesInDiff` (~1932),
    `scanTestWeakening` (~1960), `evaluateCoverageResult` (~2032),
    `findReusableVerify` (~2344), evidence assembly (~2290–2305).
  - `bin/lib/status.js:110`, `bin/lib/worktree-plan.js:278`.
  - `bin/lib/worktree.js` — `worktree add` (~237: `addArgs.push(dest, "-b",
    name); if (from) addArgs.push(from);`): record the fork point right after
    `git(root, addArgs)`.
  - `bin/ai-flow.js` — `--base` flag wiring for verify/check.
  - Tests: `test/harness.test.js` (coverage/risk), `test/worktree.test.js`.
- **Areas to avoid**: `ship.js`'s own base resolution (~97) — leave it; a
  later cleanup can reuse `resolveDiffBase`.

## Technical Notes

- Thread the resolved base as a parameter (`{ mergeBase }`) through the five
  functions instead of each calling git again; keep the old zero-arg
  signatures working for external callers by defaulting to
  `resolveDiffBase(cwd).mergeBase`.
- Epic-number matching for `nearest`: `story-07-01-…` → `07`; candidate
  branches are local branches whose name contains `epic-07` or `EPIC-07`
  (case-insensitive, bounded by non-digits).

## Decisions

- Reuse key includes `mergeBase`: a proof made against another base is a
  different proof.
