# Story 09-02 — Plan

## Implementation Context

- **Execution mode**: STANDARD.
- **Likely files**: `bin/lib/harness.js` — `runValidationCommand` (~1374,
  `stdoutTail` ~1410), `resolveValidationCommands`, `printVerify` (~1495);
  `bin/lib/ship.js` PR body; tests with fake commands (`node -e
  "console.log('Cached: 5 cached, 5 total')"`).
- **Comment at harness.js ~1360** already discusses `turbo test` in a
  monorepo — read it before changing anything around timeouts/output.
