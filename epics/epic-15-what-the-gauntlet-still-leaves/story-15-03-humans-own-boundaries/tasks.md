# Story 15-03 — Tasks

- [x] flow-plan section + readiness rule + eval prompt; `plugin sync`.
- [x] Recipes per stack in bootstrap; tests.
- [x] policyGlobs defaults; flow-recover architecture inventory row.
- [x] `npm test`; verify; CHANGELOG (Added).

## Result

Landed by `worktree land` as `57ed048`, after a green post-land validation
(`.coding-flow/runs/2026-11-10T19-24-26-084Z-verify.json`, scoped against
`develop`'s recorded fork point `4c7280c`). The land ran with the worktree's
CLI: the story adds a `policyGlobs` default, so the primary's older CLI read
the proof as stale. The story's own proof lived in the removed worktree.

### Decisions

- A sibling module (`quality-recipes.js`) rather than rows in the security
  table: the shape is shared (root markers, nothing written), the output field
  and the `present` check are not.

### Rollback Notes

- `git revert` of the story commit. No config is written by the scan, no
  migration; a project that copied a suggested command into
  `validation.quality` keeps it (its own choice). The extra policy glob only
  adds a `policy-changed` warning.

## Status: done
