# Story 19-04 — Plan

## Implementation Context

- **Execution mode**: STANDARD.
- **Likely files**: `bin/lib/verify-jobs.js` (new), `bin/ai-flow.js` and
  `bin/lib/usage.js` (flags), `bin/lib/harness.js`,
  `test/verify-jobs.test.js` (new), `test/cli-help.test.js`.
- **Search anchors**: `verify --story`, `USAGE`, `writeVerifyEvidence`.
- **Scout pre-step**: no.
- **Areas to avoid**: `run_in_background` advice in skills beyond one line
  in `/flow-run`: "start long verifies with `--detach` and `--wait`".

## Technical Notes

- Reuse 19-03's queue: a detached job waits in the queue like any verify.
- `/flow-run` gains one line (stay under 500); `plugin sync`; evals.

## Decisions

- **The job file is the source of truth**, not the process table.

## Test Plan

Spawn a detached verify on a temp repo with a slow fake command; status,
wait, lost (kill -9 the child), superseded (commit mid-run), cancel.

## Acceptance Traceability

- 1–5 → `test/verify-jobs.test.js`

## Commands

```bash
npm test
```
