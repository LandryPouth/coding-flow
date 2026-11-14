# Story 13-10 — The security core stays high-risk

## Status: planned

Found by the independent review of story 13-03 on `develop` (2026-11-14,
P1). 13-03 put "the files that decide a denial or a proof" in this
repository's `highRiskPaths`. Story 15-02 then moved the guard's shell
parser into `bin/lib/shell-writes.js`, which was never added, and other
modules that decide a denial or a proof never were: a change that weakens
the guard or the risk scoring itself runs STANDARD, not STRICT.

*(QUICK — this repository's `.coding-flow/harness.json` and one test; a
`policy-changed` signal on this diff is expected and explained in a
`## Policy Change` section.)*

## Acceptance Criteria

- [ ] `.coding-flow/harness.json` `highRiskPaths` covers the modules that
      decide a denial, a risk level or a proof: at least
      `bin/lib/shell-writes.js`, `bin/lib/risk.js`, `bin/lib/harness-config.js`,
      `bin/lib/validation-run.js`, `bin/lib/diff-scope.js`,
      `bin/lib/claim.js`, `bin/lib/policy-drift.js` (and `bin/lib/hook.js`,
      `scripts/test-env-guard.js` if they decide a denial).
- [ ] A test loads this repository's `harness.json` and asserts that every
      module `bin/lib/guard.js` and `bin/lib/evidence.js` require (directly)
      scores high, so the next extraction cannot drop one silently (review
      13-03 P2-1: criterion 2 of 13-03 had no regression test).
- [ ] `## Policy Change` in this story says why the bar rises.
- [ ] Existing tests stay green, unmodified.

## Out of Scope

- Changing the default `highRiskPaths` shipped to users.
