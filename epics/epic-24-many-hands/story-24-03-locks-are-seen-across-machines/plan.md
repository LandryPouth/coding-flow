# Story 24-03 — Plan

## Implementation Context

- **Execution mode**: STRICT.
- **Likely files**: `bin/lib/locks-refs.js` (new), `bin/lib/worktree.js`
  (`worktreeLock`, `worktreeUnlock`), `bin/lib/status.js`, `bin/lib/next.js`,
  `bin/lib/worktree-plan.js`, tests `test/locks-refs.test.js` (new).
- **Search anchors**: `worktreeLock`, `activeStoryLockPath`, `git push`.
- **Scout pre-step**: no.
- **Areas to avoid**: placement-store's local lock file.

## Technical Notes

- Atomic create on the remote: `git push origin <sha>:refs/coding-flow/locks/x`
  with `--force-with-lease=refs/coding-flow/locks/x:` (empty expected value).

## Decisions

- **Refs, not a branch**: no checkout noise, no history to merge.

## Test Plan

Bare remote + two clones in temp dirs; concurrent lock attempts.

## Acceptance Traceability

- 1–5 → `test/locks-refs.test.js`

## Commands

```bash
npm test
```
