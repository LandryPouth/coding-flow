# Story 14-07 — Plan

## Implementation Context

- **Execution mode**: STANDARD.
- **Likely files**: `bin/lib/coverage.js` (`parseLcov` keeps `FN`, `BRDA`,
  `DA` per file — check what it retains today), `bin/lib/complexity.js`
  (new, core), `bin/lib/coverage-gate.js` (signal), `bin/lib/recover.js`
  (ranking), `bin/lib/harness-config.js` (`functionSize`).
- **Reference**: Uncle Bob study, Experiment 2 (30-line script, plausible
  top entries on this repository: `shellWrites` ≈ 110).

## Decisions

- **Warning by default.** A threshold a team never chose must not block them;
  enforcement is a config decision (entry 4: policy lives in `harness.json`).

## Acceptance Traceability

- 1–2, 4 → `test/complexity.test.js`; 3 → `test/complexity-signal.test.js`;
  5 → `test/recover-scan.test.js`.
