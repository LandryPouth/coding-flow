# Story 13-04 — Tasks

- [x] `policyGlobs` default and config read.
- [x] Contrary signal + `## Policy Change` / `--policy-change`, tests first.
- [x] Report line; usage; CHANGELOG (Added).

## Result

`policy-changed` contrary signal (`bin/lib/policy-drift.js`), `policyGlobs` in `harness-config.js`, `## Policy Change` / `--policy-change` in `evaluateContrarySignals`; tests in `test/policy-changed.test.js`.

Not marked done: no green verify of this story is on record. Its code
(`2489e3b`) went straight to `develop`. A verify run on 2026-11-10 from
`develop` came back NOT PROVEN and did not even measure this story. `develop`
carries `branch.develop.codingFlowBase = 4c7280c`, a merge made *after*
`2489e3b`, so the scope was the 98 files changed since then. The verdict came
from `bin/lib/shell-writes.js`, the 15-02 stub missing from the lcov. All three
validation commands passed (`.coding-flow/runs/2026-11-10T19-02-36-304Z-verify.json`).
To prove this story, verify it with a base before `2489e3b` once 15-02 has
filled `shell-writes.js`.

### Rollback Notes

`git revert`; no data or config migration.
