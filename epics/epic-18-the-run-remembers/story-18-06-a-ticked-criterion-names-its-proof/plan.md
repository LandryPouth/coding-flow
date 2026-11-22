# Story 18-06 — Plan

## Implementation Context

- **Execution mode**: STRICT (claim-binding rule; entry 9 amendment).
- **Likely files**: `bin/lib/coverage-gate.js` (`readAcceptanceCriteria`),
  `bin/lib/evidence.js` (criteria in evidence, contrary signals),
  `bin/lib/story.js` (traceability section), `bin/lib/coverage.js` (lcov
  files), `templates/.claude/skills/flow-run/SKILL.md` (one rule, 324 lines),
  `docs/design-decisions.md` entry 9; tests
  `test/acceptance-criteria.test.js`, `test/criteria-drift.test.js`.
- **Search anchors**: `readAcceptanceCriteria`, `failOnContrarySignals`,
  `Acceptance Traceability`, `Amended by story 08-03`.
- **Scout pre-step**: no.
- **Areas to avoid**: coverage thresholds.

## Technical Notes

- Which files ran: node:test/jest/vitest spec reporters print file names;
  19-01's parser is the natural source — if 19-01 has not landed, use the lcov
  `SF:` lines and the reporters already parsed by `selectFailureLines`.
- `AI_FLOW_DRIVEN` is defined by 20-01; until then the env check is inert
  and covered by a unit test.

## Decisions

- **Bind to a test file, not a test name**: names drift; files are what runners
  report reliably. The name stays in the line for the reviewer.

## Test Plan

Fixture stories with each traceability form; driven vs interactive vs strict
outcomes; stale observation.

## Acceptance Traceability

- 1–4 → `test/acceptance-criteria.test.js::traceability binding`
- 5 → review of `docs/design-decisions.md`

## Commands

```bash
npm test
```
