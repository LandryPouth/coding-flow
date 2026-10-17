# Story 12-02 — Plan

## Implementation Context

- **Execution mode**: STANDARD.
- **Likely files**: `bin/ai-flow.js` (dispatch: intercept `--help`/`-h`
  before any command function; unknown-flag check per command),
  `bin/lib/bootstrap.js` (the "promoted from minimal to full" path — grep
  `promoted`), `bin/lib/commands.js` (usage table, if that is where it
  lives), tests (`test/cli-help.test.js` iterating the command table).
