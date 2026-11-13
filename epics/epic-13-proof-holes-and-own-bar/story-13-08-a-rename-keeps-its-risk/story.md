# Story 13-08 — A rename keeps its risk

## Status: planned

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

- [ ] Given a file moved out of a `highRiskPaths` directory and edited, then
      the diff risk is `high`, as if it had not moved.
- [ ] Given the same under `failOnContrarySignals` at the base with a
      contrary signal, then verify fails.
- [ ] Coverage scoping is unchanged: the moved file is measured at its new
      path only (existing coverage tests stay green, unmodified).
- [ ] The comment in `bin/lib/coverage-gate.js` that names this exception is
      removed; CHANGELOG `[Unreleased]` → Fixed.
