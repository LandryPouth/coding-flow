# Story 22-03 — Plan

## Implementation Context

- **Execution mode**: STANDARD.
- **Likely files**: `bin/lib/ladder.js` (new), `bin/lib/review.js`
  (`category`), `bin/lib/events.js`, `test/ladder.test.js` (new).
- **Search anchors**: `review.found`, `proposals`, `conventions`.
- **Scout pre-step**: no.
- **Areas to avoid**: lint configs of the target project (only proposed).

## Technical Notes

- Rung detection: convention line contains the category slug in an HTML
  comment marker; checks and gates reference it in a comment or config key.

## Decisions

- **Rule of three**, as RULES.md applies it to abstractions.

## Test Plan

Fixture findings across stories; rung detection from fixture repo edits.

## Acceptance Traceability

- 1–4 → `test/ladder.test.js`

## Commands

```bash
npm test
```
