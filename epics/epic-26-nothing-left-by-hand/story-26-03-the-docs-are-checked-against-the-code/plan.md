# Story 26-03 — Plan

## Implementation Context

- **Execution mode**: STANDARD.
- **Likely files**: `bin/lib/docs-check.js` (new), `bin/lib/doctor.js`,
  `bin/ai-flow.js`, tests `test/docs-check.test.js` (new) with a fixture
  repository.
- **Shared identifiers**: `docs.check.include`, `docs.check.exclude`,
  `docs.check.ignorePaths`.
- **Search anchors**: `git ls-files`, `package.json` workspace reading in
  `bootstrap`.
- **Scout pre-step**: no.
- **Areas to avoid**: rewriting docs.

## Decisions

- **Mechanical only**: three checks with near-zero false positives beat a
  fuzzy one nobody trusts.

## Test Plan

Fixture repo with a renamed file, a missing script, a broken anchor,
placeholders and URLs; `--changed`.

## Acceptance Traceability

- 1–5 → `test/docs-check.test.js`

## Commands

```bash
npm test
```
