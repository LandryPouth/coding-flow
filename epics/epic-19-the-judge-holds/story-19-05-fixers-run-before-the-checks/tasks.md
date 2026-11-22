# Story 19-05 — Tasks

- [x] Read how `validation.commands` and `validation.quality` are resolved
      and refused unattended.
- [x] Add `validation.fix`, run order, `fixedFiles`.
- [x] Config template comment (as a `bootstrap --scan` recipe, see plan.md
      Decisions); tests.
- [ ] Run `npm test`, then `ai-flow verify --story <this story>`, the review
      the mode requires, and add a CHANGELOG entry.

## Status: in-progress

## Result

- `validation.fix` (config) and `## Fixers` (plan.md) resolved in
  `bin/lib/validation-run.js`; run first by `runFixers` in
  `bin/lib/evidence.js`, each result `kind: "fix"`; `fixedFiles` from
  `workingTreeSnapshot`/`changedPaths` (`bin/lib/identity.js`); printed by
  `bin/lib/harness-report.js`; listed by `verify --dry-run` and
  `run --dry-run`; skipped by `land` (`runFix: false`).
- `bin/lib/fix-recipes.js` + `## Fixer Recipes` in `bootstrap --scan`.
- Tests: `test/harness-fixers.test.js` (16), `test/worktree.test.js` (1).
- Docs: README verify paragraph, `docs/rules-and-limits.md`, CHANGELOG.

### Rollback Notes

Revert the story's commits: `validation.fix` is only read when declared, so
no project config needs migrating.
