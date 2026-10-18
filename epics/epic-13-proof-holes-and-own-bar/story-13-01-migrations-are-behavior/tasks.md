# Story 13-01 — Tasks

- [x] Discovery: read `coverage-gate.js` ~300–360 and where `riskPaths` are matched.
- [x] Write the five tests; see the first one fail on the current code.
- [x] High-risk ⇒ behavior in the file split; reason lists excluded files.
- [x] `npm test`; `ai-flow verify`; CHANGELOG `[Unreleased]` (Fixed).
- [x] DOGFOODING row of 2026-10-18 (migration-only diff) → resolved.

## Result

### Rollback Notes

- `git revert` of the story commit restores the old split. No data, config or
  migration involved; existing `harness.json` files are not rewritten.
