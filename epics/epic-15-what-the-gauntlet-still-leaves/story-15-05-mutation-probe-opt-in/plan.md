# Story 15-05 — Plan

## Implementation Context

- **Execution mode**: STRICT. Depends on 15-04 (go), 14-03 (runner), 14-04.
- **Likely files**: `bin/lib/mutation.js` (core, from
  `scripts/mutation-probe.js`), `bin/lib/evidence.js`,
  `bin/lib/coverage-gate.js` (contrary signal + exemption),
  `bin/lib/harness-config.js`, `harness-report.js`.

## Decisions

- **No `VULNERABLE` status** (study, table of the other tool's
  recommendations): one vocabulary for one question.

## Acceptance Traceability

- 1–5 → `test/mutation.test.js`.
