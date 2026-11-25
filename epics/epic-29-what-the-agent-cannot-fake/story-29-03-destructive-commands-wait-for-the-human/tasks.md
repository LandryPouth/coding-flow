# Tasks — 29-03

## Status: done

- [x] Scout: `guard.js` Bash path, `shell-writes.js` segments/words, the guard config reader
- [x] `destructive.js` rules table (TDD, red→green per row)
- [x] guard: deny/warn/off, `allowDestructive`, primary checkout check, denials
- [x] `/flow-run` line (both copies), docs rows, design-decisions note if a rule changes
- [x] Security questions answered in plan.md
- [ ] `ai-flow verify --story`

## Human to-do

- Decide whether this repository sets `"worktrees": { "primaryLocked": true }`
  in `.coding-flow/harness.json` (D11): the run's land script merges in the
  primary checkout, and would then be refused.
- Scripts that run `git branch -D` through the agent (the run's `land.sh` deletes
  its `proof-*` branch that way) are refused once this lands: `git branch -d`
  works there (the branch is merged).

## Result

- `bin/lib/destructive.js` (new, pure) reads the destructive commands of a line;
  `bin/lib/guard.js` settles their disk checks and applies `destructiveCommands`,
  `allowDestructive`, `worktrees.primaryLocked`; a write that loosens that policy,
  and any shell write or removal of `harness.json`, is refused.
- Warn mode logs `guard-warnings.jsonl`. `/flow-run`: a destructive step is a
  `## Needs you`. Docs: `docs/rules-and-limits.md`.
- Tests: `test/guard-destructive.test.js` (every row and its near miss, one test
  per review finding, the two backstops on forms nobody listed, and the everyday
  workflow allowed — Lens B); two earlier tests moved a now-refused command into
  its own deny assertion (`guard-directory-swap`, `guard-shell`), their original
  premise kept.
- **The claim, re-scoped (plan.md D-cap):** the guard refuses the destructive forms
  an agent writes by habit and marks unchecked what it cannot read; a form built
  to evade it is out of its reach (sandbox and permissions, design-decisions 10).
- **Review:** first series 4 rounds (P1 7 / 5 / 9 / 4), the cap, then the re-scope;
  new series 4 rounds (P1 2 / 1 / 0 / 0), rounds 3 and 4 clean in a row — STRICT
  done. Every P1 fixed with a test that failed first; P2s fixed or sent to 29-04.

### Rollback Notes

Revert the story's commits: the guard returns to write and secret checks only.
To relax it without a revert, a project sets `"destructiveCommands": "warn"` or
`"off"` in `.coding-flow/harness.json` (a human edit).
