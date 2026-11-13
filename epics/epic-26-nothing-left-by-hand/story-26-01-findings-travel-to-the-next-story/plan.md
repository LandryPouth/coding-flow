# Story 26-01 — Plan

## Implementation Context

- **Execution mode**: STANDARD.
- **Likely files**: `bin/lib/run-state.js`, `bin/lib/run.js`,
  `bin/lib/drivers/claude.js` (prompts), `bin/lib/report.js` (20-07),
  `skills/flow-run/SKILL.md` (`### Handed risks`, `### Doubts`), tests
  `test/open-risks.test.js` (new).
- **Shared identifiers**: `openRisks`, `### Handed risks`, `### Doubts`,
  `risk.*` events.
- **Search anchors**: `resolve`, `documented`, `Needs you`.
- **Scout pre-step**: no.
- **Areas to avoid**: review capture semantics (18-04).

## Decisions

- **Match by files and identifiers, not by text**: cheap, explainable; the
  count line keeps unmatched risks visible.

## Test Plan

Stub agents across a 3-story fixture epic; risk matched, unmatched, closed,
reopened by a blocked story.

## Acceptance Traceability

- 1–4 → `test/open-risks.test.js`

## Commands

```bash
npm test
```
