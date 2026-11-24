# Story 19-05 — Tasks

- [x] Read how `validation.commands` and `validation.quality` are resolved
      and refused unattended.
- [x] Add `validation.fix`, run order, `fixedFiles`.
- [x] Config template comment (as a `bootstrap --scan` recipe, see plan.md
      Decisions); tests.
- [x] Run `npm test`, then `ai-flow verify --story <this story>` (green,
      coverage verified), and add a CHANGELOG entry. Review 1: FAIL (1 P1,
      4 P2), review 2: FAIL (1 P1, 2 P2), review 3: FAIL (1 P1,
      8 P2), review 4: FAIL (2 P1) → re-scoped (plan.md D-cap); re-scoped
      round 1: FAIL (2 P1, 2 P2), round 2: FAIL (1 P1, 5 P2), round 3: FAIL
      (1 P1, 4 P2), round 4: PASS (0 P1, 6 P2, all fixed).

## Review History

- First series (4 rounds): P1 per round 1, 1, 1, 2 — all FAIL; then
  re-scoped (plan.md D-cap: a fixer's file is the story's diff).
- Re-scoped series (4 rounds): P1 per round 2, 1, 1, 0 — round 4 PASS,
  tested against real prettier 3.10.1; its six P2s fixed before close.

## Status: done

## Result

- `validation.fix` (config) and `## Fixers` (plan.md) resolved in
  `bin/lib/validation-run.js`; run first by `runFixers` in
  `bin/lib/evidence.js`, each result `kind: "fix"`; `fixedFiles` from
  `workingTreeSnapshot`/`changedPaths` (`bin/lib/identity.js`); printed by
  `bin/lib/harness-report.js`; listed by `verify --dry-run` and
  `run --dry-run`; skipped by `land` (`runFix: false`).
- The fixers run before anything reads the tree (`fixFirst`). A fixer may
  not rewrite `.coding-flow/` or any story root (red, naming the ignore-file
  remedy); a same-value JSON reformat there is listed as `reformatted`, the
  guard's own log writes as `guardLogs`. With fixers declared, reuse also
  matches on `fixerRootsDigest`. The audit ledger dedupes by run file.
- Verify: green, coverage verified (see the evidence of the closing run).
- `bin/lib/fix-recipes.js` + `## Fixer Recipes` in `bootstrap --scan`.
- Tests: `test/harness-fixers.test.js` (67), `test/worktree.test.js` (1),
  `test/layering.test.js` (module classified).
- Docs: README verify paragraph, `docs/rules-and-limits.md`, CHANGELOG.

### Rollback Notes

Revert the story's commits: `validation.fix` is only read when declared, so
no project config needs migrating.
