# Story 14-04 — Tasks

- [x] Tests first (five criteria) on throwaway repos with a hand-written lcov.
- [x] Claim evaluation; flag and `## Claim:`; evidence and report.
- [x] `/flow-recover` refactor mode: characterization tests in their own
      commit first, then the refactor under `--claim refactor`; `plugin sync`.
- [x] `npm test`; verify; independent review; CHANGELOG (Added).
- [x] Hand over to story 15-02 (the `shellWrites` split under the claim) —
      15-02 is planned on `--claim refactor` and depends on this story.

## Result

`verify --claim refactor` and a story's `## Claim: refactor` now evaluate one
promise on the diff: no existing test file changed, no weakening signal,
commands green, and the added lines executed by a fresh coverage report at
`minPatchCoverage`. The claim is recorded in the evidence, can only be replayed
for the same claim kind, and is printed as held or with the files that broke it.
`/flow-recover` gained its refactor mode (characterization tests in their own
commit, then the refactor under the claim); `plugin sync` refreshed `skills/`.

Files: `bin/lib/claim.js` (new, core), `bin/lib/coverage-gate.js` (shared file
classification), `bin/lib/diff-scope.js` (rename-aware test detection and
space-safe diff paths), `bin/lib/evidence.js`, `bin/lib/harness.js`,
`bin/lib/harness-report.js`, `bin/lib/usage.js`, the recover skill, its generated
copy, `test/claim-refactor.test.js`, `test/layering.test.js`,
`scripts/test-env-guard.js`, `test/test-env-guard.test.js`, `CHANGELOG.md`, and
`docs/DOGFOODING.md` (the cross-checkout pinned-source race found while verifying).

Tests: `node --test test/claim-refactor.test.js` (45 tests, including the
fail-closed cases found in independent review: pure deletion, no merge base, a
renamed existing test, a report that omits the added lines, zero unchanged test
files, `--claim=`, and a rename into `.coding-flow/`) and the full `npm test` suite; `ai-flow verify --story`
captures the result.

### Independent review (2026-11-09)

A STRICT `/flow-review` by a subagent failed the story with one P1, shown on
throwaway repos: an `ignoredPaths` in `harness.json`, or a test-runner config
(`tests.config.js`, `vitest.config.js`) skipping the edited test, held the claim
while behavior changed — in standard mode a policy change is only a warning.
Fixed, each with a test that fails on the previous code:

- the claim is **code only**: a changed policy file fails it in any mode (no
  `## Policy Change` clears it), and so does any non-behavior file that is not
  prose or a type declaration (config, lockfile, generated output, data);
- a diff with no code file fails (`no-code`) instead of holding with nothing
  measured;
- existing tests are compared in the project's frame and checked with
  `git cat-file` at the base, so a subdirectory install sees its edited tests;
  unchanged tests are counted from `git ls-tree` at the base, not the disk;
- a stale coverage report is now pinned by a test (the `since: null` mutant
  survived before, and is killed now);
- the held message says the coverage is the whole suite's, new tests included;
  `run` and the `ship` PR body name a failed claim instead of a bare FAILED.

A second independent review failed it again with three P1s, each a way around
the first fix, all shown on throwaway repos — fixed, each with a test that fails
on the first-round code (7 tests):

- `policyGlobs: []` in the same diff switched the policy check off — under the
  claim the default policy globs always apply;
- a `package.json` `jest` key (or `.mocharc.yml`, `pytest.ini`: a kind no report
  measures) was skipped by coverage — under the claim a skipped file fails;
- dropping a test command from the plan's `## Commands` skipped it — every
  command the plan ran at the base must still run (a plan with none at the base
  fails closed);
- P2s: an edited test with a non-ASCII name was read through git's quoted path
  (fixed for every diff-scope git call with `core.quotePath=false`); an
  untracked new test with `.only` escaped the weakening scan; the held message
  overclaimed and now says "N test files from the base untouched";
- the remedy the skill gave (test change in an earlier commit of the same
  branch) could never hold, since the claim diffs from the fork point: the skill
  and story 15-02 now land the test-only change on its own branch first;
- P3s: prose is matched by extension, not directory; the PR body says when the
  claim held.

A third independent review failed it with two P1s, both fixed, each with a test
that fails on the second-round code (4 tests):

- a runner config with a code extension (`.mocharc.js` dropping a spec) was
  code, and a changed file no test loaded hid under the 20% tolerance — runner
  and setup files are policy under the claim, and a code file absent from the
  report fails on its own;
- deleting the plan's `## Commands` section fell back to `package.json` and
  skipped the comparison — the base plan's commands are compared whatever the
  source;
- P2: `--base HEAD~1` (or a `codingFlowBase`) past a test edit dropped it from
  the diff — the claim's base must be held by another branch; 15-02's spec now
  says two branches, as its plan does; `addedLinesByFile` reads unquoted paths.

A fourth independent review failed it with one P1 and one P2, both fixed, each
with a test that fails on the third-round code (3 tests):

- a line only *removed* from a file no report measures (a `posttest` script in
  `package.json`, a `Makefile` recipe line) dropped a suite and held the claim
  — such a file now fails whether lines were added or removed;
- once pushed, `origin/<branch>` counted as "another branch" holding a narrowed
  base — a ref holding any of this branch's own commits no longer counts.

P3s answered in the skill: a conditional skip in a new test reads as
weakening (land it on the test-only branch); a pure dead-code removal is proven
with a plain verify; on the default branch the claim needs `--base`; a `.md`
that is the product reads as prose. Left: a story writing `**Claim:**` in bold
is not read (no claim, so no claim to trust); `scripts/test-env-guard.js`
landed with this story because verify needed it in this checkout.

A fifth independent review **passed** (no P0/P1). Its P2: the round-4 base fix
did not hold when the upstream (or a backup branch) sat exactly at the narrowed
base, so the record overclaimed. Fixed after that pass, with a test that fails
on the round-4 code: a `--base` strictly after the base the branch would use
without the flag is refused, whatever ref holds it; a widening `--base` is
still accepted (tested). Its P3s are documented limits: a code-extension
runner script with a line only deleted (covered by "a code file whose lines
were only deleted"), and a `codingFlowBase` set past a test edit is caught only
when no other ref holds that commit.

The trigger eval (`evals/cases/flow-recover.json`) gets no refactor case: it
tests routing, and a refactor request routes to `/flow-run` — widening the
skill's description for a mode would grow the front door.

Left as known limits (named in the skill): coverage counts lines run by new
characterization tests; a test helper outside `testGlobs` and the runner list
counts as code, as do tests inside a code file (Rust `mod tests`, doctests); a
`.md` fixture outside the test tree is prose; a git-ignored new test is not
seen; in a monorepo, a changed test outside the install reads as new; a file whose lines were only deleted, in a diff
that adds lines elsewhere, is not measured (that needs a coverage run at the
base); the coverage report's paths in a subdirectory install follow the shared
coverage gate, so an honest refactor there can fail on a path mismatch (fails
closed); `## Claim:` inside a fenced block is still read (fails closed); a new
test can still write a forged report under a name it does not spell out, or
stub the moved module for the existing tests in a shared-process runner.

### Review after landing (2026-11-09)

A `/flow-review` of the landed commit passed (no P0–P2, three P3s, verify run
fresh, eleven mutants of the claim checks all killed). Its P3s and residual
risks, fixed, each with a test that fails on the landed code:

- a recorded fork point (`codingFlowBase`) narrowing the diff past this
  branch's own commits is refused like a narrowing `--base`: both are compared
  with the base the branch would use without either (`resolveDiffBase`
  `ignoreForkPoint`), and the failure names that wider base;
- a new test file, tracked or not, that names the coverage report the claim
  reads (`lcov.info`, `coverage-final.json`, configured `coverageReports`)
  fails the claim (`test-names-report`) — a name scan, not a proof;
- a `## Claim` section opening with prose declares no claim; a known kind
  followed by a note is still read, a lone misspelt kind still fails;
- `run` prints every reason a story is not proven (coverage, contrary, claim)
  instead of the first;
- the CHANGELOG entry is cut to the promise and what breaks it.

Still a known limit: a new test stubbing the moved module for the existing
tests in a shared-process runner — catching it means running the base tests
without the new ones, a design change rather than a fix.

### Rollback Notes

Revert the commit: the new flag and `## Claim:` reader are additive, no evidence
format is migrated, and older evidence without a `claim` field still reads (it
simply cannot be replayed for a claim run). No data or schema change.
