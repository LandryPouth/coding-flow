# Story 24-02 — Plan

## Implementation Context

- **Execution mode**: STRICT — unattended merges.
- **Likely files**: `bin/lib/run.js`, `bin/lib/run-state.js`,
  `bin/lib/merge-queue.js` (new), `bin/lib/worktree.js`
  (`conflictingFiles`, scratch worktree), `bin/lib/backbone.js`,
  `bin/lib/drivers/claude.js` (crossing review), tests
  `test/merge-queue.test.js` (new), `test/run.test.js`.
- **Search anchors**: `conflictingFiles`, `parseBackbone`, `withFileLock`.
- **Scout pre-step**: no.
- **Areas to avoid**: single-chain run behaviour.

## Technical Notes

- Concurrency in the driver: two child agent processes, one queue; state file
  updates under `withFileLock`.

## Decisions

- **Park the later chain**: the earlier one already passed alone.

## Test Plan

Stub agents; fixture epic with two roots and a shared file; red merge.

## Acceptance Traceability

- 1–2 → `test/run.test.js::parallel`
- 3–5 → `test/merge-queue.test.js`

## Commands

```bash
npm test
```
