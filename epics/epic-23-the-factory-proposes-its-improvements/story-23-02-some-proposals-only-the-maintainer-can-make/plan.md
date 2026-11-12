# Story 23-02 — Plan

## Implementation Context

- **Execution mode**: STRICT — the boundary of what the tool may suggest as
  routine.
- **Likely files**: `bin/lib/proposal-check.js` (new),
  `bin/lib/proposals.js`, the weakened-tests detector (search `weakened`),
  `test/proposal-check.test.js` (new).
- **Search anchors**: `weakened`, `coverage-gate`, `budgetUsd`,
  `allowedTools`.
- **Scout pre-step**: no.
- **Areas to avoid**: the gates themselves.

## Technical Notes

- Unified diff parsing: file headers + hunk bodies; reuse any diff parser in
  `bin/lib` (search `@@`).

## Decisions

- **Protected list in code, not config**: a config the tool could propose to
  change would be the hole itself.

## Test Plan

Table tests per protected category; hostile notes claiming `routine`.

## Acceptance Traceability

- 1–6 → `test/proposal-check.test.js`

## Commands

```bash
npm test
```
