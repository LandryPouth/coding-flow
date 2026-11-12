# Story 21-04 — Plan

## Implementation Context

- **Execution mode**: STANDARD.
- **Likely files**: `bin/lib/insights.js`, `bin/lib/events.js`, fixtures,
  `test/insights.test.js`.
- **Search anchors**: `review.found`, `gate.fired`, `total_cost_usd`.
- **Scout pre-step**: no.
- **Areas to avoid**: gate code.

## Technical Notes

- Outcome inference for gates is defined in 18-05; this story only counts.

## Decisions

- **Precision, not volume**: a gate that fires often is not a good gate.

## Test Plan

Fixture events for each origin and gate outcome.

## Acceptance Traceability

- 1–4 → `test/insights.test.js::review and gates`

## Commands

```bash
npm test
```
