# Story 14-06 — Plan

## Implementation Context

- **Execution mode**: STANDARD.
- **Likely files**: `bin/lib/validation-run.js` (entries ~81–140, toolError
  ~259), `bin/lib/evidence.js`, `bin/lib/harness-report.js`,
  `bin/lib/bootstrap.js` (recipes), `bin/lib/recover.js` (report),
  `bin/lib/config.js` (schema), `docs/QUICKSTART.md`.

## Decisions

- **No bundled scanner, no download** (zero runtime dependencies): the
  developer installs what they want; the tool proves what ran.
- **Network failure is `not-examined`** because the field test's only
  dependency audit timed out offline; recording it as a failure would teach
  people to delete the command, as a pass would lie.

## Acceptance Traceability

- 1–3, 5 → `test/security-commands.test.js`; 4 → `test/bootstrap.test.js`.
