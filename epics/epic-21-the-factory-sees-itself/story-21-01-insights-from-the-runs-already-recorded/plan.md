# Story 21-01 — Plan

## Implementation Context

- **Execution mode**: STANDARD — walking skeleton: legacy runs + journal →
  metrics → terminal and `--json`.
- **Likely files**: `bin/lib/insights.js` (new), `bin/lib/events.js`
  (`readEvents`), `bin/ai-flow.js` (command table, `help --all`),
  `bin/lib/report.js` (shared formatting only if it already exists),
  `test/insights.test.js` (new), `test/fixtures/insights/` (new).
- **Search anchors**: `readEvents`, `-verify.json`, `selectFailureLines`,
  `help --all`.
- **Scout pre-step**: no.
- **Areas to avoid**: verify, the journal writer.

## Technical Notes

- Reuse the throwaway script's arithmetic from the 2026-11-12 baseline (in the
  plan) as the fixture's expected numbers.
- Event `story` keys are story directories; legacy runs carry `story` or a
  path — normalise with the existing story resolver.

## Decisions

- **Backfill in memory, never rewritten**: legacy files stay the source.
- **Counts below 20**: a percentage of 3 means nothing and invites optimising
  noise.

## Test Plan

Fixture directories (legacy only, journal only, both) → snapshot of `--json`.

## Acceptance Traceability

- 1–4 → `test/insights.test.js`
- 5 → `test/help.test.js::insights in --all`

## Commands

```bash
npm test
```
