# Story 13-08 — A rename keeps its risk

## Status: in-progress

Found by story 13-04's fourth review (2026-11-13): under a base with
`failOnContrarySignals: true` and `highRiskPaths: ["src/auth/**"]`,
`git mv src/auth/login.js src/login.js` plus an edit and an `.eslintrc.json`
rule verifies green (`enforced: false`), while the same change without the
move fails. `changedFilesForCoverage` (`bin/lib/diff-scope.js` ~180) runs
`git diff --name-only` with rename detection, so only the new path is scored
(`bin/lib/risk.js` ~232); the high-risk old path is never seen. Pre-existing,
not introduced by 13-04.

*(QUICK — the risk score reads both sides of a rename; behavioural tests.)*

## Acceptance Criteria

- [x] Given a file moved out of a `highRiskPaths` directory and edited, then
      the diff risk is `high`, as if it had not moved.
- [x] Given the same under `failOnContrarySignals` at the base with a
      contrary signal, then verify fails.
- [x] Coverage scoping is unchanged: the moved file is measured at its new
      path only (existing coverage tests stay green, unmodified).
- [x] The comment in `bin/lib/coverage-gate.js` that names this exception is
      removed; CHANGELOG `[Unreleased]` → Fixed.

## Decisions

- `riskPathsInDiff` (`bin/lib/diff-scope.js`) is `changedFilesForCoverage` plus
  the old side of every rename read from one `--find-renames --name-status`
  diff of the working tree against the base (HEAD with none). Every diff-risk
  call site uses it (`risk.js` `scoreCombinedRisk`, `coverage-gate.js` coverage
  gate and `strictestRisk`, `evidence.js` preflight, `status.js`,
  `worktree-plan.js`); `changedFilesForCoverage` is unchanged, so coverage,
  weakening and deleted-test scans still see the new path only.
- A pure move (`R100`) adds no old path: it changes no line, so it keeps the
  risk of its new path (first review's P1, option a — without it a pure move
  out of `**/auth/**` turned high and failed the default coverage gate). The
  diff is cumulative, so a move then an edit in a later commit reads below
  100 % and is scored high.
- No separate working-tree source (review P2): an unstaged `mv` already reads as
  a deletion plus an untracked file, and the deletion names the old path
  (`an unstaged move and edit is scored high` passes at the base too).
- The old side of a rename is a path with no added lines, like a deleted file,
  so the structural scan finds nothing in it; only `highRiskPaths` matching
  changes.
- The coverage-scope test edits a second `src/auth/` file so coverage runs at
  the base too: it pins that the old path never enters the coverage scope,
  independently of this story's risk change.

## Result

- `test/rename-risk.test.js` (9 tests): moved-and-edited file scores `high`
  and names the old path; verify fails under `failOnContrarySignals` with an
  open criterion; same change without the move fails (baseline); a pure move
  stays `low` and verifies green; a move then a later edit is `high`; an
  unstaged move is `high`; a tree that empties `highRiskPaths` under a base that
  names `src/auth/**` still enforces (`strictestRisk`); `status --json` marks
  the done story `reviewRequired`; coverage lists the new path only. Tests 1, 2,
  5, 7, 8 fail at the base; test 4 failed on the first fix (`ee7efdb`).
