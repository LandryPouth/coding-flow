# Story 14-03 — Tasks

- [x] Scout: worktree creation/cleanup, env/deps linking, git helpers in core.
- [x] Tests first: the five criteria, including the error-path cleanup.
- [x] `red-at-base.js` (classified CORE in `test/layering.test.js`); flag; evidence; report; bootstrap suggestion.
- [x] `/flow-recover` fix mode and `/flow-run` (bug fix, STRICT) call it;
      `/flow-review` Tests Deep reads it; `plugin sync`; eval cases unchanged
      or extended.
- [x] `npm test`; verify; independent review (STRICT); CHANGELOG (Added).

## Result

`ai-flow verify --red-at-base` is implemented and wired through the CLI, the
evidence, the report, `bootstrap --scan`, and the three skills. The new
module `bin/lib/red-at-base.js` runs the changed test files in two throwaway
worktrees (merge base and HEAD), copies HEAD's test files into the base tree,
and links dependency directories and env files from the primary checkout. It
is ok only for red at base → green at HEAD, refuses a test that passes at base
or cannot run there for a setup reason, and cleans up both worktrees on every
path. `npm test` is green (1239 tests) and the story's verify passes.

The first STRICT independent review found three P1s and three P2s: a worktree
leak when setup threw before the cleanup handle existed, a symlink-following
copy that could clobber a file outside the base tree, dropped refusal reasons,
`--clean-env` not reaching the targeted command, red running on a refused
verify, and missing regression tests. All were fixed: the scratch directory is
allocated before the first git command, test-file parents and destinations are
materialized without following symlinks or hard links, refusals carry their
reason, the clean env is threaded through, red is skipped on refusal, and tests
now cover no-test-file, uncommitted-test, setup-throw cleanup, cache reuse,
symlink replacement, `--clean-env`, and an unchanged user tree/stash. A second
fresh independent review passed with only P3 nits (a `..`-prefix path guard and
placeholder re-expansion), both fixed.

A later STRICT review found that renamed/copied fixtures and test-runner
startup failures (Vitest resolution, Go undefined symbols) could still look
like a red. The scope is now deliberately conservative: the base tree is the
merge base plus the HEAD test files only. Added non-test files and modified
non-code files are refused before the worktrees are built ("cannot run in a
clean tree"), and a setup/compile failure is refused unless the error line names
the test or the stack names changed code. The report also prints a failed
red-at-base when the coverage gate blocks instead of hiding it.

### Rollback Notes

Delete `bin/lib/red-at-base.js`, revert the `redAtBase` plumbing in
`harness-config.js`, `evidence.js`, `harness.js`, `harness-report.js`,
`usage.js`, `validation-run.js`, `bootstrap.js`, and `test/layering.test.js`,
then revert the three skill templates and run
`node bin/ai-flow.js plugin sync`. Remove the CHANGELOG and README additions.
The `redAtBase` key is additive, so an existing `.coding-flow/harness.json`
needs no migration in either direction.
