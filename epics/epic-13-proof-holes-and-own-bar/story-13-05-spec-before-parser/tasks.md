# Story 13-05 — Tasks

- [x] Criteria at base vs HEAD; three outcomes; tests first.
- [x] `## Spec Change` declaration.
- [x] flow-plan rule + eval prompt; `plugin sync`.
- [x] CHANGELOG (Added).

## Result

`criteria-changed` and `spec-in-diff` contrary signals, `## Spec Change`, and
the corpus-first rule in `/flow-plan` (`a34e258`, `e3ddc8d`). Landed with
`worktree land` on the third try; the post-land validation on the merged
result was green (the two red tries are the 2026-10-19 row of
`docs/DOGFOODING.md`). That worktree's `runs/` are gone, so this checkout holds
no captured verify.

### Rollback Notes

`git revert`; no data or config involved.

## Status: done
