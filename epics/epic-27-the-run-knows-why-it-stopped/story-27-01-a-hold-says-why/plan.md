# Story 27-01 — Plan

## Implementation Context

- **Execution mode**: STANDARD — walking skeleton.
- **Likely files**: `bin/lib/holds.js` (new), `bin/lib/run-state.js`, `bin/lib/status.js`, `bin/lib/next.js`, `bin/lib/guard*.js`, tests `test/holds.test.js` (new).
- **Shared identifiers**: `Hold:`, `hold.set`, `hold.clear`, hold reasons.
- **Search anchors**: `## Status`, `blocked`, `deriveStatus`, `rankNext`.
- **Scout pre-step**: no.
- **Areas to avoid**: the driver's process invocation (20-01).

## Decisions

- **One vocabulary**: eight reasons, sub-reasons free-form but listed in the doc.

## Test Plan

Fixture run states and journals; guard denial; next ranking.

## Acceptance Traceability

- 1–5 → see the test files above.

## Commands

```bash
npm test
```
