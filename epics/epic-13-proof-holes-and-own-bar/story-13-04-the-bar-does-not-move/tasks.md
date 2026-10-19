# Story 13-04 — Tasks

- [x] `policyGlobs` default and config read.
- [x] Contrary signal + `## Policy Change` / `--policy-change`, tests first.
- [x] Report line; usage; CHANGELOG (Added).

## Result

`policy-changed` contrary signal (`bin/lib/policy-drift.js`), `policyGlobs` in `harness-config.js`, `## Policy Change` / `--policy-change` in `evaluateContrarySignals`; tests in `test/policy-changed.test.js`.

### Rollback Notes

`git revert`; no data or config migration.
