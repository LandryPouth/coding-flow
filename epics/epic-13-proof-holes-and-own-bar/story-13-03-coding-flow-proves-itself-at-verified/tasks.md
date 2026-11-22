# Story 13-03 — Tasks

- [x] Validation command with lcov; `coverage/` ignored; run verify, see `verified`.
- [x] `highRiskPaths` for the security core in this repo's `harness.json`.
- [x] Default `blockedPaths` + doctor warning for explicit lists, with tests.
- [x] contributing.md note; CHANGELOG (Changed: default blockedPaths).

## Result

See `spec.md` → Result (verified in the story's worktree, `f86b52c`; that
worktree and its `runs/` are gone, so this checkout holds no captured verify).

Re-proved 2026-11-14 at the story's own commit: a re-verify on `develop`
read NOT PROVEN, because a function this story touched grew in later
stories' commits inside the 413-file window. `f86b52c` was checked out in a
scratch worktree and verified with its own CLI against its parent
(`--base` on a temporary branch at `f86b52c~1`): passed, 3 commands, 15
files, coverage 100% of 43 added lines. Evidence
`.coding-flow/runs/2026-11-14T04-32-27-988Z-verify.json`, copied into the
primary checkout; the scratch worktree and branches were removed.

### Rollback Notes

See `spec.md`.

## Status: done
