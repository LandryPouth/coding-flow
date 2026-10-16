# Story 06-02 — Plan

## Implementation Context

- **Execution mode**: STANDARD.
- **Likely files**:
  - `bin/lib/doctor.js` — the OpenCode section added in 0.12.1 (grep
    `opencode`, "behind" — commit dd0bf6c "say when the OpenCode install for
    every project is behind").
  - `bin/lib/opencode.js` — export a small `pluginHasV2Entry(source)` next to
    `isOurs`, so doctor does not re-encode the token.
  - `test/doctor.test.js` — fake `opencode` script on a temp `PATH`.
- **Areas to avoid**: running any OpenCode subcommand other than `--version`.

## Decisions

- Severity "failure" on 2.x: the guard is absent, not outdated. Same reasoning
  as a missing Claude hook.
