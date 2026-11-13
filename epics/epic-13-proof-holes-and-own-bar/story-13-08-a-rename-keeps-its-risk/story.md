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
  the same diffs read with `--no-renames`, so both sides of a rename are named.
  Every diff-risk call site uses it (`risk.js` `scoreCombinedRisk`,
  `coverage-gate.js` coverage gate and `strictestRisk`, `evidence.js` preflight,
  `status.js`, `worktree-plan.js`); `changedFilesForCoverage` is unchanged, so
  coverage, weakening and deleted-test scans still see the new path only.
- The old side of a rename is a path with no added lines, like a deleted file
  (already in the list before this story), so the structural scan finds nothing
  in it; only `highRiskPaths` matching changes.
- A pure move (no edit) out of a high-risk directory now also scores `high`: it
  changes what lives under that path, like a deletion does.

## Result

- `test/rename-risk.test.js`: moved-and-edited file scores `high` and names the
  old path; verify fails under `failOnContrarySignals` with an open criterion;
  same change without the move fails (baseline); coverage lists the new path
  only. Related suites (312 tests: contrary, coverage, risk, status,
  worktree-plan, evidence, policy, mutation) green.
