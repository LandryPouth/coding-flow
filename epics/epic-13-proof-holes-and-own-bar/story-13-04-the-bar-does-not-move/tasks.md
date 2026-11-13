# Story 13-04 — Tasks

## Status: in-progress

- [x] `policyGlobs` default and config read.
- [x] Contrary signal + `## Policy Change` / `--policy-change`, tests first.
- [x] Report line; usage; CHANGELOG (Added).

## Result

`policy-changed` contrary signal (`bin/lib/policy-drift.js`), `policyGlobs` in `harness-config.js`, `## Policy Change` / `--policy-change` in `evaluateContrarySignals`; tests in `test/policy-changed.test.js`.

Proven 2026-11-13: `ai-flow verify --story <this story> --base 72dabd5` passed,
coverage **verified** (96.6 % of 6,749 added lines executed, min 80 %), scope 296
files since `72dabd5`, the commit before `2489e3b`. The base is explicit because
both the worktree fork point (`develop`) and `develop`'s recorded
`codingFlowBase` (`4c7280c`) postdate the story's code (DOGFOODING 2026-11-10).
The first run on that scope was NOT PROVEN by the size ratchet (`printHelp`
105→106, `evaluateContrarySignals` 76→94); `1e05550` split both, behaviour
unchanged. One warning remains: `policy-changed` on `.coding-flow/harness.json`,
the story's own signal firing on the wide scope (13-03 and 13-06 changed that
file), not a failure outside strict.

### Rollback Notes

`git revert`; no data or config migration.
