# Story 13-03 — Plan

## Implementation Context

- **Execution mode**: STANDARD (config + one default + one doctor check).
- **Likely files**: `.coding-flow/config.json`, `.coding-flow/harness.json`,
  `.gitignore`; `bin/lib/harness-config.js` (default `blockedPaths`, ~218);
  `bin/lib/doctor.js` (a warning next to the existing harness checks);
  `docs/contributing.md` (Node ≥ 20 for the maintainer verify).
- **Tests**: `test/guard-paths.test.js` (deny into runs/ledger),
  `test/doctor-*.test.js` pattern for the warning; the `verified` criterion
  is checked by running `ai-flow verify` here and recorded in the Result.
- **Measured baseline**: suite 145 s plain, 161 s under coverage, 96.3 % lines.

## Decisions

- **Maintainer verify ≠ CI command.** CI keeps `npm test` on three Node
  versions; the coverage run is the proof `verify` records. One suite, two
  invocations.
- **Doctor warns, never rewrites** an explicit user list (hard rule:
  non-destructive).

## Acceptance Traceability

- criterion 3 → `test/guard-paths.test.js`; criterion 4 → doctor test;
  criteria 1–2 → this story's own verify evidence.
