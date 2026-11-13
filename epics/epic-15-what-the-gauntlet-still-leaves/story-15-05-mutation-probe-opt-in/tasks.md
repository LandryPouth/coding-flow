# Story 15-05 — Tasks

## Status: done

- [x] Confirm 15-04's verdict is go; otherwise close this story.
- [x] Tests first; module from the probe script; signal; exemption.
- [x] `npm test`; verify; independent review (three STRICT passes); CHANGELOG (Added).

## Result

15-04 said **go**. `harness.json` `mutation: { command, maxMutants, link }`
turns on `bin/lib/mutation.js`, which `verify` calls through `extraProofs`
(`bin/lib/evidence.js`) on a green suite: on a `high` risk diff or under
`--claim refactor` it spawns `scripts/mutation-probe.js` (15-04's probe, now in
`package.json` `files`) on merge base..HEAD, seeded by the tree token. Evidence
`mutation: { ran, enforced, ok, seed, killed, survived, unexcused, apart,
durationMs, mutants, exemption?, limits }`; printed by `printMutation`
(`bin/lib/harness-report.js`), and NOT PROVEN ("N mutant(s) survived the
tests (mutation probe)") only when enforced. `test/mutation.test.js`: 9 tests,
each criterion seen red first; five defects put back one at a time (trigger,
seed, `file:line` token, refactor `{files}`, enforcement) each turn a test red.

Verify (2026-11-13, `TMPDIR` in the session scratchpad):
`ai-flow verify --story epics/epic-15-what-the-gauntlet-still-leaves/story-15-05-mutation-probe-opt-in`
— passed, `Coverage: verified` (93.7 % of 207 added lines), scope: diff against
`develop` (fork point), 10 files. A first run failed on
`test/layering.test.js` (the new module unclassified — fixed, `mutation` is
core) and on `command-timeout.test.js` under load (8/8 alone). The suite took
1 199.6 s of its 1 200 s budget while two other verifies ran on the machine.

### Rollback Notes

`git revert` the story's commits. Nothing persists: the probe runs only when
`mutation` is declared in `harness.json`, and removing the key turns it off.

### Review 1 (independent, STRICT, fail) — fixed, full verify pending

P1: an empty probe passed under strict and was replayed by the cache — a
high-risk edit left uncommitted was mutated as HEAD (0 sites, "ok"), and
once committed `verify` answered "already proved". Now no decided mutant
(no site in the committed JS/TS lines) and uncommitted JS/TS changes are
"not examined", and `canStandIn` never replays a probe that did not answer.
P2s: HTML comments in a `## Mutation Exemption` excuse nothing; the
tree-token test read an undefined field (now `provenance.git.treeToken`, with
a tracked edit — an untracked file makes verify record a null token, a
pre-existing defect noted in plan.md); a whole-probe budget
(`mutation.timeoutMs`, 30 min); CHANGELOG/README say JS/TS only, what cleanup
covers, and that the worktree shares refs, stash and config; `ship` and `run`
carry a Mutation line. 15 tests in `test/mutation.test.js`; each new guard
(decided, dirty, cache, HTML, budget) was put back one at a time and turns its
test red. Targeted suites green (80/80); the full verify waits for a free
machine.

### Review 2 (independent, STRICT, fail) — fixed, full verify pending

P1 confirmed closed. Five P2s: a `## Mutation Exemption` section entirely
inside an HTML comment still excused (comments now stripped before the
section is cut out); the budget was not a hard bound — a detached grandchild
holding the command's pipes made 1.5 s take 28.6 s (the probe now closes the
pipes 2 s after `sh` exits); `mutation.head` was recorded but never compared
(a replay now needs the same HEAD); "uncommitted" blocked on any untracked
JS file and missed `package.json` (now: tracked files only, prose and Coding
Flow's directories aside); a failing not-examined probe read ⚠️ (now ❌).
The tree test has its untracked file back, asserting `git status` and the
content. 21 tests in `test/mutation.test.js`; each new guard put back one at
a time turns its test red. Targeted suites 136/136, the probe's own 50
included.

### Review 3 (independent, STRICT, pass) — P2s fixed, verified

Fenced code blocks no longer hold an exemption; HEAD is read once before the
probe and passed as `--head`; markdown under `fixtures/` or matching
`testGlobs` counts as behaviour; the per-mutant timer is cleared and the exit
code fixed when `sh` exits. 25 tests in `test/mutation.test.js`; each new
guard put back turns its test red.

Final verify (2026-11-13, after merging `develop`):
`ai-flow verify --story epics/epic-15-what-the-gauntlet-still-leaves/story-15-05-mutation-probe-opt-in`
— passed, `Coverage: verified` (93.7 % of 367 added lines), scope: diff
against `develop` (fork point), 15 files. Review captured (pass, p1 1, p2 11).
`harness check` fails only on the known pre-existing fixtures
(`test/guard.test.js:95,141`, `test/harness.test.js:56`).

### Alignment with 13-04 (after its merge) — targeted review pass, P2s fixed

`develop` merged (13-04, `3aa04b9`). `enforced` is 13-04's `contraryEnforced`;
the probe's trigger reads `strictestRisk`, shared with it: mode and
`failOnContrarySignals` at the stricter of the base and the tree, risk at the
higher of the two configs. A base commit whose `harness.json` is missing or
unreadable is scored with the defaults (`readBaseConfig`); `atBase` and the
risk are read once and passed to `contraryEnforced`. Tests: a diff stepping
down from strict, a diff dropping its path from `highRiskPaths`, a base
harness absent or invalid JSON, and a 13-04 witness in
`test/contrary-signals.test.js`.

Verify after the alignment: passed, 94.1 % of 393 added lines (17 files).
Final verify after the P2s: passed, `Coverage: verified` (94.3 % of 404
added lines), 18 files, evidence `2026-11-13T20-50-57-446Z-verify.json`.
