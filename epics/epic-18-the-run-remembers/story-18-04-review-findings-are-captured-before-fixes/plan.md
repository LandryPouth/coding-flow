# Story 18-04 — Plan

## Implementation Context

- **Execution mode**: STANDARD (new subcommands on an existing command; the
  stale rule change is narrow and tested).
- **Likely files**: `bin/lib/review.js` (`reviewCapture`, `parseCount`,
  `reviewCommand`), `bin/lib/status.js` (review column), `bin/lib/events.js`
  (from 18-01), `bin/lib/usage.js`, `test/review.test.js`,
  `test/review-verdicts.test.js`, `test/status-review.test.js`.
- **Search anchors**: `reviewCapture`, `review: stale`, `reviewer`,
  `findingCounts`.
- **Scout pre-step**: no.
- **Areas to avoid**: `/flow-review` prose beyond one paragraph telling the
  reviewer to emit findings as JSON for `--from`.

## Technical Notes

- `/flow-review` (templates/.claude/skills/flow-review/SKILL.md, 284 lines)
  gains the JSON shape for findings; then `plugin sync`; skill evals stay
  green.
- Reviewed-file set: the diff's file list at capture time, stored with each
  file's blob hash.

## Decisions

- **Find-then-resolve over a single richer capture**: the order of events is
  the information.
- **Legacy counts stay readable** so 184 bethl reviews are not lost; they are
  labelled, never mixed with found counts.

## Test Plan

CLI tests for found/resolve/capture; refusal with an open P1; legacy origin;
status column; stale on reviewed vs unreviewed file changes.

## Acceptance Traceability

- 1, 6 → `test/review.test.js::found then resolved`
- 2 → `test/review-verdicts.test.js::open p1 refuses pass`
- 3 → `test/review.test.js::legacy counts origin`
- 4 → `test/status-review.test.js::self review in strict`
- 5 → `test/status-review.test.js::stale only on reviewed files`

## Commands

```bash
npm test
```
