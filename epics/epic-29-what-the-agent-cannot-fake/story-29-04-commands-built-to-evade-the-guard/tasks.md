# Story 29-04 — Tasks

- [x] Interpreter strings, git alias values, written-then-run scripts.
- [x] The unread-forms table in rules-and-limits, with its test.
- [x] psql DROP SCHEMA/TABLE/TRUNCATE, SQL from stdin, `\!`; rm/git rm -f of a modified file; prefix env.
- [ ] Run `npm test`, then `ai-flow verify --story <this story>`, the review
      the mode requires, and add a CHANGELOG entry.

## Status: in-progress

## Result

The 29-03 reader now reads, as unproven (unchecked; refused in strict),
destructive text in interpreter code (`python -c`, `node -e`, `perl -e`,
`ruby -e`, `php -r`), policy-file names or destructive commands built from
pieces, `git config alias.x` values, files the line writes then runs, psql's
`\!` and SQL psql reads from its input. It refuses `DROP SCHEMA|TABLE` and
`TRUNCATE` in `psql -c`, and `rm`/`unlink`/`git rm -f` of a tracked file with
uncommitted changes. A git alias under `HOME=`/`GIT_CONFIG_GLOBAL=`/`GIT_DIR=`
is unchecked. What it still does not read is one table in
`docs/rules-and-limits.md`, each form with its cover. Latency on 29-03's
everyday list: unchanged within noise (plan.md D9). Round 1 (2 P1, P2s) fixed: heredoc-written and copied scripts read, glued interpreter flags, escapes and argument lists, more SQL and `psql -f`, staged-only `rm` allowed, `rm` answered from `.git/index` without a spawn (plan.md, Review round 1). Round 2 (3 P1) fixed: a linear literal scanner (the list regex could hold the hook past its timeout), psql flag clusters, `\!`/`\i` read in every SQL source, SQL literals blanked, `DELETE` without `WHERE` per statement (plan.md, Review round 2).

## Acceptance Traceability

1. `test/guard-evasion.test.js::interpreter code: a string literal read as a destructive command makes the call unchecked`
2. `test/guard-evasion.test.js::interpreter code: the policy file built from pieces is unchecked`
3. `test/guard-evasion.test.js::git config: an alias set to a destructive command is unchecked when it is set`
4. `test/guard-evasion.test.js::a script file written and run on the same line is read through what was written`
5. `test/guard-evasion.test.js::rules-and-limits: one table names every unread form with what covers it`
6. `test/guard-evasion.test.js::psql: DROP SCHEMA/TABLE and TRUNCATE are refused; SQL from stdin is read when seen`
7. `test/guard-evasion.test.js::rm and git rm -f of a modified tracked file are refused; of a clean file allowed`
8. `test/guard-destructive.test.js::Lens B: the everyday workflow is allowed`

### Rollback Notes

Revert the story's commits: the reader additions are confined to
`bin/lib/destructive.js` (plus two exports and `php -r` in
`bin/lib/shell-writes.js`, and the `unproven` branch in `judgeDestructive`).
