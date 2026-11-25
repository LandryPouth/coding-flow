# Story 26-07 — Tasks

- [x] Discovery: read 26-02's `todo.js` as shipped, `next.js` (`buildQueue`,
      empty message), `ship.js` PR body, guard secret patterns.
- [x] `## Human to-do` parsing: `when`, derived ids, dedupe story/index,
      masking; `ai-flow todo done <id>` under a file lock.
- [x] `next`: We need you block above the recommendation, ordering, 5-line cap
      and `later` count, all epics including landed ones, empty-queue message,
      `--json` `needsYou`.
- [~] `ai-flow todo` also lists open browser checks and open risks (26-01's
      register), deferred from 26-02; skip if 26-01 has not landed and say so.
- [x] `status` header line; `ship` PR body `Before you deploy`; land, autoland
      and closure print.
- [x] `verify` warning and `doctor` check `todo.uncaptured`
      (`todo.uncapturedPatterns`), `when` and secret checks.
- [x] Skills `flow-plan`, `flow-run`, `flow-review`, `flow-next` (and template
      copies): write a `## Human to-do` item when a human-only action appears;
      `/flow-next` reports the block verbatim.
- [x] `docs/rules-and-limits.md`: new rows; README `next` section.
- [ ] Run `npm test`, then `ai-flow verify --story <this story>`, the review
      the mode requires, and add a CHANGELOG entry.

## Acceptance Traceability

1. `test/human-todo.test.js::criterion 1: a before-deploy item is printed above the recommendation, with its id`
2. `test/human-todo.test.js::criterion 2: deploy first, then next-story items and the question, then one later line`
3. `test/human-todo.test.js::criterion 3: no ranked command and one open to-do prints "No command to run — but we need you:"`
4. `test/human-todo.test.js::criterion 4: a landed epic whose index holds an open before-deploy item is still listed`
5. `test/human-todo.test.js::criterion 5: todo done ticks only that line, and neither next nor todo lists it again`
6. `test/human-todo.test.js::criterion 6: a Result in French with no Human to-do passes verify with a todo.uncaptured warning; doctor too`
7. `test/ship-before-deploy.test.js::criterion 7: ship prints the before-deploy item and the PR body gets a Before you deploy section` and `::criterion 7: with no before-deploy item, ship prints nothing and the section is absent (or removed)` (POSIX only: the fake `gh` is a shebang script)
8. `test/human-todo.test.js::criterion 8: a to-do holding a secret is a doctor error and is printed masked`
9. `test/human-todo.test.js::criterion 9: next --json holds needsYou with id, when, epic, story, text, source`

## Result

`## Human to-do` is read by 26-02's reader (`bin/lib/todo.js`), with `when`,
ids, story-over-index dedupe and masking; `next` prints the We need you block,
`status` its header line, `todo done <id>` ticks one checkbox, `ship` prints and
writes `Before you deploy` in the PR body, `land`/`autoland` print the landed
story's items; `verify` and `doctor` warn `todo.uncaptured` and `todo_when`,
`doctor` errors `todo_secret`. Decisions D1–D11 in plan.md. The browser-check
and open-risk lines of `ai-flow todo` wait for 26-01 (D10); the epic closure's
print is a task of 26-04 (D9).

### Rollback Notes

- Code: `bin/lib/todo.js`, `next.js`, `status.js`, `ship.js`, `worktree.js`,
  `doctor.js`, `evidence.js`, `harness-report.js`, `commands.js`, `usage.js`,
  `bin/ai-flow.js`; skills `flow-plan`, `flow-run`, `flow-review`, `flow-next`
  (templates and the synced `skills/`). `git revert` undoes it.
- No migration, no config written. `todo done` edits only the checkbox the user
  names; reverting the code leaves those ticks in place, which is correct.
- The lock file lives in the git dir (`coding-flow/todo.lock`) and is removed
  after each tick.
