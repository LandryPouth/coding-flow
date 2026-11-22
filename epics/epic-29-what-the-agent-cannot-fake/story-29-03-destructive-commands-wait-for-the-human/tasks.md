# Tasks — 29-03

## Status: in-progress

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
- Tests: `test/guard-destructive.test.js` (19 tests, every row and its near miss);
  two earlier tests moved a now-refused command into its own deny assertion
  (`guard-directory-swap`, `guard-shell`), their original premise kept.

### Rollback Notes

Revert the story's commits: the guard returns to write and secret checks only.
To relax it without a revert, a project sets `"destructiveCommands": "warn"` or
`"off"` in `.coding-flow/harness.json` (a human edit).
