# Story 27-04 — Plan

## Implementation Context

- **Execution mode**: STRICT — unattended merges of the base.
- **Likely files**: `bin/lib/scheduler.js` (new), `bin/lib/run.js`, `bin/lib/merge-queue.js`, tests `test/scheduler.test.js`, `test/base-sync.test.js` (new).
- **Shared identifiers**: `run.syncBase`, `parked: base-sync`.
- **Search anchors**: `parseBackbone`, `conflictingFiles`.
- **Scout pre-step**: no.
- **Areas to avoid**: the driver's process invocation (20-01).

## Decisions

- **Merge, not rebase**: proofs stay attached to commits that still exist.

## Test Plan

Fixture trees for ordering; moving base with clean and conflicting merges.

## Acceptance Traceability

- 1–4 → see the test files above.

## Commands

```bash
npm test
```
