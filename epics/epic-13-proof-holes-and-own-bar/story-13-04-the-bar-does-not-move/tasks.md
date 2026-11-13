# Story 13-04 — Tasks

## Status: in-progress

- [x] `policyGlobs` default and config read.
- [x] Contrary signal + `## Policy Change` / `--policy-change`, tests first.
- [x] Report line; usage; CHANGELOG (Added).

## Result

`policy-changed` contrary signal (`bin/lib/policy-drift.js`), `policyGlobs` in `harness-config.js`, `## Policy Change` / `--policy-change` in `evaluateContrarySignals`; tests in `test/policy-changed.test.js`.

Green 2026-11-13 (not a proof of this story alone): `ai-flow verify --story <this story> --base 72dabd5` passed,
coverage **verified** (96.6 % of 6,749 added lines executed, min 80 %), scope 296
files since `72dabd5`, the commit before `2489e3b`. That scope also holds the
neighbouring stories of epics 13–15: the run proves the whole window, of which
this story is a part, not this story in isolation. The base is explicit because
both the worktree fork point (`develop`) and `develop`'s recorded
`codingFlowBase` (`4c7280c`) postdate the story's code (DOGFOODING 2026-11-10).
The first run on that scope was NOT PROVEN by the size ratchet (`printHelp`
105→106, `evaluateContrarySignals` 76→94); `1e05550` split both, behaviour
unchanged. One warning remains: `policy-changed` on `.coding-flow/harness.json`,
the story's own signal firing on the wide scope (13-03 and 13-06 changed that
file), not a failure outside strict.

After the second review's fixes (`6a6ca4d`), three verifies with the same
command came back FAILED, each on a timing test outside this story's diff:
`test/command-timeout.test.js:76` (`node fast.js` cut at its 500 ms limit) three
times, and `test/mutation-probe.test.js:544` once. Both pass alone (8/8 three
times; the probe file failed once alone too). Load average was 19–28, with
story 15-05's verify running at the same time. A fourth, alone, failed only on
`mutation-probe.test.js:544`, a race in that test (fixed on `develop`, `dffd898`).

Green 2026-11-13 after merging `develop` (`2f4f428`): same command, passed,
coverage **verified** (96.6 % of 6,785 added lines executed), scope 349 files
since `72dabd5`, evidence `2026-11-13T19-31-17-291Z-verify.json`. As above, the
window holds the neighbouring stories too: green on the whole window, not a
proof of this story alone. One warning: `policy-changed` on
`.coding-flow/harness.json`.

Green again after the third review's fixes (`8c6a481`, `9468898`) and a merge of
`develop` (`4e7d8f6`): same command, passed, coverage **verified** (96.6 % of
6,810 added lines), scope 349 files, evidence
`2026-11-13T19-50-22-930Z-verify.json`, same single warning. Same caveat: the
window, not this story alone.

### Rollback Notes

`git revert`; no data or config migration.
