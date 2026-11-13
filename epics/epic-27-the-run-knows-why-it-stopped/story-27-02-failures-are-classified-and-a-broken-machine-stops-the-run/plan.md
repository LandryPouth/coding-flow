# Story 27-02 — Plan

## Implementation Context

- **Execution mode**: STANDARD.
- **Likely files**: `bin/lib/failure-class.js` (new), `bin/lib/circuit-breaker.js` (new), `bin/lib/run.js`, `bin/lib/drivers/claude.js`, tests `test/failure-class.test.js`, `test/circuit-breaker.test.js` (new).
- **Shared identifiers**: `run.healthCheck`, `failure.classified`, `stopped: environment`.
- **Search anchors**: `stopAfterBlocked`, `toolError`, `error_max_turns`, `failingTests`.
- **Scout pre-step**: no.
- **Areas to avoid**: the driver's process invocation (20-01).

## Decisions

- **The breaker replaces `stopAfterBlocked` as the primary stop**; the counter stays as a backstop.

## Test Plan

Stub processes for each class; two-story same-test fixture; failing health check.

## Acceptance Traceability

- 1–5 → see the test files above.

## Commands

```bash
npm test
```
