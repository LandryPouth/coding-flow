# Story 15-05 — Tasks

## Status: in-progress

- [x] Confirm 15-04's verdict is go; otherwise close this story.
- [x] Tests first; module from the probe script; signal; exemption.
- [~] `npm test`; verify; CHANGELOG (Added) — done; independent review pending.

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
