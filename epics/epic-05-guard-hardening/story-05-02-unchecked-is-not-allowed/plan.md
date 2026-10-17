# Story 05-02 — Plan

## Implementation Context

- **Execution mode**: STRICT.
- **Likely files**:
  - `bin/lib/guard.js` — `decide` (~238: the two early `allow` returns),
    `evaluate` (~438: the catch), `recordDenial` (~351: generalise to
    `recordEvent(kind)` writing `denials.jsonl` or `guard-unchecked.jsonl`),
    `WRITE_TOOLS` (top of file).
  - `bin/lib/opencode.js` — `PLUGIN_BODY`: `spawnGuard` error branch and the
    `local` null case.
  - `bin/lib/report.js` (grep `denials.jsonl`) and `bin/lib/doctor.js`.
  - `test/guard.test.js`, `test/report.test.js`, `test/doctor.test.js`.
- **Areas to avoid**: changing what a deny looks like to any host.

## Decisions

- Separate log file rather than a `kind` field in `denials.jsonl`: existing
  readers of `denials.jsonl` (report, external scripts) keep their meaning
  "the guard refused this".
