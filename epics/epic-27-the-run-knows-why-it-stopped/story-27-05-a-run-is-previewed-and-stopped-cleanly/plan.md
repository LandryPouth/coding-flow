# Story 27-05 — Plan

## Implementation Context

- **Execution mode**: STANDARD.
- **Likely files**: `bin/lib/run.js`, `bin/lib/run-plan.js` (new), `bin/ai-flow.js`, tests `test/run-plan.test.js`, `test/run-stop.test.js` (new).
- **Shared identifiers**: `run --plan`, `--stop`, `--abort`, `stopped: requested|aborted`.
- **Search anchors**: `process.kill(-pid)`, `agent-slots`.
- **Scout pre-step**: no.
- **Areas to avoid**: the driver's process invocation (20-01).

## Decisions

- **Stop is a file the driver polls** (`.coding-flow/runs/<id>.stop`), so it works from any terminal.

## Test Plan

Fixture epics; stub agents; process group kill observed.

## Acceptance Traceability

- 1–4 → see the test files above.

## Commands

```bash
npm test
```
