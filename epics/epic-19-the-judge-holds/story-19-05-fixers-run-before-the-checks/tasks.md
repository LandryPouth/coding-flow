# Story 19-05 — Tasks

- [x] Read how `validation.commands` and `validation.quality` are resolved
      and refused unattended.
- [x] Add `validation.fix`, run order, `fixedFiles`.
- [x] Config template comment (as a `bootstrap --scan` recipe, see plan.md
      Decisions); tests.
- [x] Run `npm test`, then `ai-flow verify --story <this story>` (green,
      coverage verified), and add a CHANGELOG entry. Review 1: FAIL (1 P1,
      4 P2), review 2: FAIL (1 P1, 2 P2), review 3: FAIL (1 P1,
      8 P2), review 4: FAIL (2 P1) → re-scoped (plan.md D-cap); fixed; re-review pending.

## Status: in-progress

## Result

- `validation.fix` (config) and `## Fixers` (plan.md) resolved in
  `bin/lib/validation-run.js`; run first by `runFixers` in
  `bin/lib/evidence.js`, each result `kind: "fix"`; `fixedFiles` from
  `workingTreeSnapshot`/`changedPaths` (`bin/lib/identity.js`); printed by
  `bin/lib/harness-report.js`; listed by `verify --dry-run` and
  `run --dry-run`; skipped by `land` (`runFix: false`).
- `bin/lib/fix-recipes.js` + `## Fixer Recipes` in `bootstrap --scan`.
- Tests: `test/harness-fixers.test.js` (37), `test/worktree.test.js` (1),
  `test/layering.test.js` (module classified).
- Docs: README verify paragraph, `docs/rules-and-limits.md`, CHANGELOG.

### Rollback Notes

Revert the story's commits: `validation.fix` is only read when declared, so
no project config needs migrating.
