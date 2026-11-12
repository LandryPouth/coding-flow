# Story 20-03 — Plan

## Implementation Context

- **Execution mode**: STANDARD.
- **Likely files**: `bin/lib/drivers/claude.js`, `bin/lib/run.js`,
  `bin/lib/config.js`, `test/run-driver-claude.test.js`.
- **Search anchors**: `run.agent.end`, `processTimeoutMin`, `verifyStoryEntry`.
- **Scout pre-step**: no.
- **Areas to avoid**: verify internals.

## Technical Notes

- Kill the whole process group (`detached: true`, `process.kill(-pid)`), the
  C compiler post shows an agent can `pkill` its own loop — the driver must not
  run inside the agent's process group.

## Decisions

- **Fresh process per attempt** rather than `--resume`: context rot and the
  research's "fresh context per unit" pattern.

## Test Plan

Stub agent scenarios: fail-then-pass, hang, always-fail, machine-busy.

## Acceptance Traceability

- 1–5 → `test/run-driver-claude.test.js::attempts`

## Commands

```bash
npm test
```
