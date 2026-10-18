# Story 14-02 — Plan

## Implementation Context

- **Execution mode**: STANDARD.
- **Likely files**: `bin/lib/recover.js` (parser `readFindings`),
  `bin/lib/status.js` (section + JSON), `bin/lib/next.js` (ranking),
  `bin/lib/doctor.js` (public-repo warning; `gh` is optional — absent means
  "visibility unknown", no warning, say so), evidence lookup through the
  existing runs reader used by `status`.
- **Tests**: `test/recover-status.test.js`, `test/next.test.js` additions,
  fake `gh` on `PATH` as in the ship tests.

## Decisions

- **The agent may write `State: fixed`; only the tool says "proven".** Same
  split as story status (`## Status: done` vs proof-derived state).
- **Run reference by file name** (`2026-…-verify.json`), the identifier the
  runs directory already uses.

## Acceptance Traceability

- 1–4, 7 → `test/recover-status.test.js`; 5 → `test/next.test.js`;
  6 → `test/doctor-recovery.test.js`.
