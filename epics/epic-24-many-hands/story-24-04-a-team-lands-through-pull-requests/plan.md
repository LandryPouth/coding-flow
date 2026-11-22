# Story 24-04 — Plan

## Implementation Context

- **Execution mode**: STANDARD.
- **Likely files**: `bin/lib/worktree.js` (`worktreeLand`),
  `bin/lib/worktree-plan.js` (autoland), `bin/lib/ship.js`,
  `bin/lib/sync.js` (new or in `status.js`), `bin/lib/run-report.js`,
  tests `test/ship.test.js`, `test/worktree-autoland.test.js`.
- **Search anchors**: `shipCommand`, `gh pr`, `autoLandIfChainFinished`.
- **Scout pre-step**: no.
- **Areas to avoid**: ship's body rewriting rules.

## Technical Notes

- Stub `gh` on PATH in tests, as ship tests already do (check).

## Decisions

- **Default `local`**: no push unless the project chose PRs.

## Test Plan

Stub gh; autoland in both modes; sync releasing locks.

## Acceptance Traceability

- 1–2 → `test/worktree-autoland.test.js::land modes`
- 3 → `test/sync.test.js` (new)
- 4 → `test/run-report.test.js::pr links`

## Commands

```bash
npm test
```
