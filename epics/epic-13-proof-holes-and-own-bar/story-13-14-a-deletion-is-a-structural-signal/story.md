# Story 13-14 — A deletion is a structural signal

## Status: done

Found by the independent review of story 17-01 (2026-11-14): `ai-flow
archive` adds code that runs `git rm -r` on a whole epic directory, yet its
verify recorded coverage `not-required`. The diff scored `low`: `archive.js`
matches no `highRiskPaths`, and `STRUCTURAL_GIT_SIGNALS` (`bin/lib/risk.js`)
lists `worktree remove`, `branch -D`, `reset --hard` and `merge` — not
`git rm`, nor a recursive file-system delete. New code that deletes the
user's files is the case the coverage gate exists for.

*(QUICK — one list in `risk.js` plus tests; `risk.js` is a high-risk path
here since 13-10, so the verify will run STRICT anyway.)*

## Acceptance Criteria

- [x] New code calling `git rm` (any flags), `git clean`, or a recursive
      delete (`fs.rmSync(…, { recursive: true })`, `fs.rmdirSync(…, {
      recursive: true })`) through the same call shapes the existing signals
      read scores at least `medium`, so the coverage gate runs.
- [x] A call already guarded the way the existing signals accept (the
      `allowFail` pattern) keeps today's score.
- [x] Tests on throwaway repos: a diff adding a `git rm` call scores
      `medium`, the 17-01 shape included; existing risk tests unmodified.
      CHANGELOG `[Unreleased]` → Fixed.

## Result

- `bin/lib/risk.js`: three entries added to `STRUCTURAL_GIT_SIGNALS` —
  `git rm`, `git clean`, `recursive delete`. Decisions in `plan.md`.
- `test/risk-deletion-signal.test.js`: 8 tests on throwaway repos, 5 red
  before the fix (`89bdb41`), the 17-01 shape included; the 3 negative cases
  (allowFail-guarded `git rm`, non-recursive delete, `confirm`/`transform`)
  pin what must stay low. Existing risk tests unmodified and green.

### Rollback Notes

Revert the fix commit: the three signal entries go, scoring returns to the
four git signals; nothing persisted depends on them.
