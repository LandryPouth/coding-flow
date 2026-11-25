# Story 29-04 — Tasks

- [x] Interpreter strings, git alias values, written-then-run scripts.
- [x] The unread-forms table in rules-and-limits, with its test.
- [x] psql DROP SCHEMA/TABLE/TRUNCATE, SQL from stdin, `\!`; rm/git rm -f of a modified file; prefix env.
- [ ] Run `npm test`, then `ai-flow verify --story <this story>`, the review
      the mode requires, and add a CHANGELOG entry.

## Status: in-progress

## Result

The guard decides each Bash call with the strictest of two destructive
readers (`strictestReading` in `bin/lib/guard.js`): 29-03's, frozen as it
shipped at 3c90919 (`bin/lib/destructive-29-03.js` and the shell reader it
uses, `bin/lib/shell-writes-29-03.js`, both pinned by a hash and by their
output on a 568-command corpus), and this story's (`bin/lib/destructive.js`).
29-03's findings are judged by 3c90919's own judging code
(`bin/lib/destructive-judge-29-03.js`, pinned the same way), and the new
reader runs only when 29-03's did not refuse. A refusal or an unchecked from
either stands, so nothing this story reads or judges can weaken a 29-03
decision.

This story's reader adds, as unproven (unchecked; refused in strict):
destructive text in interpreter code (`python -c`, `node -e`, `perl -e`,
`ruby -e`, `php -r`, glued flags, escapes and argument lists), the policy file
or a destructive command built from pieces, `git config alias.x` values, a
file the line writes then runs (redirect, heredoc, `tee`, `cp`, download),
psql's `\!`/`\i` and SQL psql reads from stdin or `-f`, a git alias under a
config-changing prefix. It refuses `DROP SCHEMA|TABLE|OWNED|COLUMN`,
`TRUNCATE` and `DELETE` without `WHERE` in psql, and `rm`/`unlink`/`git rm -f`
of a tracked file with uncommitted changes — named, or matched by a glob or
brace (series 2 round 1). `rm` of a clean file is answered from `.git/index`
without a spawn. The new reader has a 3 s budget (then unchecked); a command
over 256 KB (UTF-8 bytes) is refused unread. The time of a whole call is
*not* bounded (out of scope, story 29-06): lines under the cap were measured
at 98 s to over 120 s (series 2 round 3), past the hook's 60 s timeout, as
at 3c90919. A removal is checked in the repository that holds the path
(another worktree's, or through a symlinked directory: series 2 round 3). A shell `rm` word reaches git as `:(literal)`/`:(glob)`, a git error is
unchecked, never clean. `shell-writes.js` keeps 29-03's behaviour (only
additive data: heredoc bodies on segments, two exports). What is still not
read is one table in `docs/rules-and-limits.md`. Latency: in-process 1.2 →
2 ms per call, the CLI cold 193 → 209 ms (reviewer's numbers; plan.md).

Review history: first series 2/3/1/2 P1 (cap reached in round 4, re-scoped to
the strictest of two readers); series 2 round 1: 1 P1 (globs); round 2: 4 P1 (a regression through the
shared judging, git errors, pathspec words, worst-case time), all fixed;
round 3: 2 P1 — a path in another repository fixed, whole-call time moved
to 29-06 (plan.md).

## Acceptance Traceability

1. `test/guard-evasion.test.js::interpreter code: a string literal read as a destructive command makes the call unchecked`
2. `test/guard-evasion.test.js::interpreter code: the policy file built from pieces is unchecked`
3. `test/guard-evasion.test.js::git config: an alias set to a destructive command is unchecked when it is set`
4. `test/guard-evasion.test.js::a script file written and run on the same line is read through what was written`
5. `test/guard-evasion.test.js::rules-and-limits: one table names every unread form with what covers it`
6. `test/guard-evasion.test.js::psql: DROP SCHEMA/TABLE and TRUNCATE are refused; SQL from stdin is read when seen`
7. `test/guard-evasion.test.js::rm and git rm -f of a modified tracked file are refused; of a clean file allowed`; `test/guard-evasion.test.js::series 2 round 1: a glob or brace naming a modified tracked file is refused`
8. `test/guard-destructive.test.js::Lens B: the everyday workflow is allowed`

### Rollback Notes

Revert the story's commits. Code: `bin/lib/destructive.js` (the new reader),
`bin/lib/destructive-29-03.js`, `bin/lib/shell-writes-29-03.js` and
`bin/lib/destructive-judge-29-03.js` (new, frozen copies), `bin/lib/guard.js` (`strictestReading`, the index fast path,
the `unproven`/budget branches of `judgeDestructive`, the glob pathspec, the
256 KB cap, `readSmall` and `gitAlias --local` on the host),
`bin/lib/shell-writes.js` (additive: heredoc data, two exports), and the three
new modules in `.coding-flow/harness.json` `highRiskPaths`. Tests and
fixtures under `test/` go with them. Reverting restores 3c90919's decisions
exactly.
