# Story 27-07 — Plan

## Implementation Context

- **Execution mode**: STANDARD.
- **Likely files**: `bin/lib/notify.js` (26-02), `bin/lib/notify-policy.js` (new), `bin/lib/report.js`, `bin/lib/insights.js`, `bin/lib/status.js`, tests `test/notify-policy.test.js` (new).
- **Shared identifiers**: `notify.remindAfterHours`, `notify.batchMinutes`, `notify.digest`, `notify.quiet`, "done with debt".
- **Search anchors**: `notify.events`, `REPORT.md`.
- **Scout pre-step**: no.
- **Areas to avoid**: the driver's process invocation (20-01).

## Decisions

- **Human latency is a first-class metric**: every other wait is machine time.

## Test Plan

Clock-injected batching, quiet hours, reminder; report projections.

## Acceptance Traceability

- 1–5 → see the test files above.

## Commands

```bash
npm test
```
