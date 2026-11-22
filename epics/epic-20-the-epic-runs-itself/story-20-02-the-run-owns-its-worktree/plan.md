# Story 20-02 — Plan

## Implementation Context

- **Execution mode**: STRICT — placement, locks, autoland.
- **Likely files**: `bin/lib/worktree-plan.js` (`decidePlacement`,
  `autoLandIfChainFinished`), `bin/lib/placement-store.js`,
  `bin/lib/worktree.js` (`worktreeAdd`, `resolveDepsStrategy`,
  `worktreeLock`, `activeStoryLockPath`), `bin/lib/diff-base.js`,
  `bin/lib/config.js`; tests `test/worktree-plan.test.js`,
  `test/worktree-autoland.test.js`, `test/placement-store.test.js`,
  `test/diff-base.test.js`.
- **Search anchors**: `not-isolated`, `codingFlowBase`, `resolveDepsStrategy`,
  `active-story.json`.
- **Scout pre-step**: no.
- **Areas to avoid**: land's merge logic.

## Technical Notes

- bethl DOGFOODING 2026-11-12 rows: "place picked the shared checkout",
  autoland from the wrong location; bilan P2.

## Decisions

- **Busy = live lock or foreign dirt**, both cheap to check, no daemon.

## Test Plan

Fixture repos for each case; fake pids for liveness.

## Acceptance Traceability

- 1 → `test/worktree-plan.test.js::busy primary`
- 2 → `test/worktree.test.js::done story lock released`
- 3–4 → `test/worktree.test.js::copyFiles`
- 5 → `test/worktree-autoland.test.js::from the primary`
- 6 → `test/diff-base.test.js::sha on base branch ignored`

## Commands

```bash
npm test
```
