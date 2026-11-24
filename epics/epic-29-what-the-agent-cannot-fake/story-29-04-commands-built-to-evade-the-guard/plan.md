# Story 29-04 — Plan

## Implementation Context

- **Execution mode**: STRICT (guard).
- **Depends on**: 29-03 (destructive reader, backstops, D9 list).
- **Likely files**: `bin/lib/destructive.js`, `bin/lib/shell-writes.js`,
  `test/guard-destructive.test.js`, `docs/rules-and-limits.md`.
- **Scout pre-step**: no.

## Decisions

- **Origin (2026-11-24):** 29-03 hit the review cap (four rounds, new
  bypasses each). The run re-scoped 29-03's claim to habitual forms and moved
  the evasion forms its reviews found (interpreter strings, two-step git
  alias, script files) here, as P2 under the new claim.
- **Unchecked, not refused:** an interpreter string can hold the words for a
  good reason (a test, a doc); the guard flags it, strict mode refuses it.

## Test Plan

`decide()` on throwaway repos for each criterion; the 29-03 Lens B list
re-asserted.

## Acceptance Traceability

- 1–6 → `test/guard-destructive.test.js`

## Commands

```bash
npm test
```
