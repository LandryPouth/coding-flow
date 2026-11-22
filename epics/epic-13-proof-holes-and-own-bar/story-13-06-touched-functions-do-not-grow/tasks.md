# Story 13-06 — Tasks

- [x] Script + tests first (four cases).
- [x] Wire into `validation.quality`; verify here.
- [x] CHANGELOG not needed (repository-internal) — confirm no user-visible change.

## Result

The function-size ratchet runs inside verify (`complexity-grew`, `1c7d913`,
fixes `3989933`, `da5747b`). Landed by `worktree land` as merge `4c7280c`, after
a green post-land validation. That worktree's `runs/` are gone, so this
checkout holds no captured verify.

### Rollback Notes

`git revert` of the merge; no data or config involved.

## Status: done
