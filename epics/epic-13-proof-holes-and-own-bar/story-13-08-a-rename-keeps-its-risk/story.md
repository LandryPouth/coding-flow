# Story 13-08 — A rename keeps its risk

## Status: done

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
  the old side of every rename, read from one `--find-renames --raw -z` diff of
  the working tree against the base (HEAD with none); `-z` keeps paths intact.
  Every diff-risk call site uses it (`risk.js` `scoreCombinedRisk`,
  `coverage-gate.js` coverage gate and `strictestRisk`, `evidence.js`
  preflight, `status.js`, `worktree-plan.js`); `changedFilesForCoverage` is
  unchanged, so coverage, weakening and deleted-test scans still see the new
  path only.
- **Every rename counts, pure or not (option b).** The first two reviews led to
  exempting a pure move (option a: first by `R100`, then by identical blob and
  mode, since `R100` also covers swapped lines and a `chmod`). The third
  review reversed it: a pure move is not without effect, because the path is
  behavior. `git mv src/middleware.ts src/mw-disabled.ts` disables a Next.js
  auth middleware, a migration moved out of `migrations/` no longer runs, and
  git can pair a deleted high-risk file with an unrelated identical one as
  `R100`, hiding the deletion. So a pure move out of a high-risk path scores
  `high`, and verify asks for a test or a Test Exemption. The cost is accepted:
  such moves are rare, and the exemption names the reason.
- This matches what `diff.renames=false` already gave: the old side listed as
  a deletion.
- An unstaged `mv` already reads as a deletion plus an untracked file, so no
  separate working-tree source is read.
- The old side of a rename is a path with no added lines, like a deleted file,
  so the structural scan finds nothing in it; only `highRiskPaths` matching
  changes.
- The coverage-scope test edits a second `src/auth/` file so coverage runs at
  the base too: it pins that the old path never enters the coverage scope,
  independently of this story's risk change.

## Result

- `test/rename-risk.test.js` (13 tests): moved-and-edited file scores `high`
  and names the old path; verify fails under `failOnContrarySignals` with an
  open criterion; same change without the move fails (baseline); a pure move
  scores `high` and verify asks for a test; a pure move of `src/middleware.ts`
  scores `high` under the default paths; a deleted `src/auth/login.js` paired
  by git with an identical `src/util/login.js` moved to `src/x.js` scores
  `high`; swapped lines and a `chmod` on a move score `high`; a move then a
  later edit is `high`; an unstaged move is `high`; a tree that empties
  `highRiskPaths` under a base that names `src/auth/**` still enforces
  (`strictestRisk`); `status --json` marks the done story `reviewRequired`;
  coverage lists the new path only.
- Checked against `git archive 5118da1` (the base): tests 1, 2, 4-9, 11 and 12
  fail there; 3 (baseline), 10 (unstaged move) and 13 (coverage scope) pass,
  as they pin behavior that already held.
