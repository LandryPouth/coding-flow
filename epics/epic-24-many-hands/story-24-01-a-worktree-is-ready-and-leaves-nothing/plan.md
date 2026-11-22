# Story 24-01 — Plan

## Implementation Context

- **Execution mode**: STRICT — deletes worktrees and stops processes.
- **Likely files**: `bin/lib/worktree.js` (`worktreeAdd`, `worktreeDest`,
  `resolveDepsStrategy`, `worktreeRemove`, `worktreeLand`, `landCleanup`),
  `bin/lib/worktree-plan.js` (`decidePlacement`, autoland),
  `bin/lib/serve.js` (new), `bin/lib/config.js` (`branch.pattern`,
  `land.waitMinutes`), `bin/lib/doctor.js`, tests `test/worktree.test.js`,
  `test/worktree-autoland.test.js`, `test/worktree-plan.test.js`,
  `test/serve.test.js` (new).
- **Search anchors**: `worktreeDest`, `requireRepo`, `EBUSY`, `skip: process.platform`,
  `branchPerEpic`.
- **Scout pre-step**: yes — the worktree code is large; map add/remove/land
  paths first.
- **Areas to avoid**: the merge strategy of land.

## Technical Notes

- Pid reuse check: read `/proc/<pid>/cwd` on Linux; on other platforms record
  the start time and compare via `ps -o lstart=`.
- bethl branch names: `fix/OPS-N-…` enforced by its hooks (memory: git hooks
  and permissions).

## Decisions

- **`serve` wrapper, not process scanning**: only what we started is ours to
  stop.

## Test Plan

Fixture repos per row; child process fixtures for serve; win32 tests
re-enabled in CI.

## Acceptance Traceability

- 1, 6 → `test/worktree.test.js`
- 2 → `test/serve.test.js`
- 3–5, 8 → `test/worktree-autoland.test.js`, `test/worktree.test.js::land`
- 7 → `test/worktree-plan.test.js::done sibling`

## Commands

```bash
npm test
```
