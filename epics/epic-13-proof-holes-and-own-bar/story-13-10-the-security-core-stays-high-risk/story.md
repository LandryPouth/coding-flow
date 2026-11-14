# Story 13-10 — The security core stays high-risk

## Status: done

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

- [x] `.coding-flow/harness.json` `highRiskPaths` covers the modules that
      decide a denial, a risk level or a proof: at least
      `bin/lib/shell-writes.js`, `bin/lib/risk.js`, `bin/lib/harness-config.js`,
      `bin/lib/validation-run.js`, `bin/lib/diff-scope.js`,
      `bin/lib/claim.js`, `bin/lib/policy-drift.js` (and `bin/lib/hook.js`,
      `scripts/test-env-guard.js` if they decide a denial).
- [x] A test loads this repository's `harness.json` and asserts that every
      module `bin/lib/guard.js` and `bin/lib/evidence.js` require (directly)
      scores high, so the next extraction cannot drop one silently (review
      13-03 P2-1: criterion 2 of 13-03 had no regression test).
- [x] `## Policy Change` in this story says why the bar rises.
- [x] Existing tests stay green, unmodified.

## Policy Change

The bar rises: this repository's `highRiskPaths` gains the modules that
decide a denial, a risk level or a proof, so a diff touching them runs STRICT
(fresh-test and contrary-signal enforcement) instead of STANDARD. Nothing is
loosened. Reason: 15-02 moved the guard's shell parser into
`bin/lib/shell-writes.js` and it stayed out of the list; review of 13-03 on
`develop` (2026-11-14) measured every module listed below scoring `low`.

## Decisions

- **The direct requires of `guard.js` and `evidence.js` are the rule**, as
  the criterion states, so the list is the code's, not a judgement call:
  `harness-config`, `security-policy`, `util`, `shell-writes` (guard);
  `context`, `policy-fingerprint`, `identity`, `coverage`, `story`, `util`,
  `harness-config`, `diff-scope`, `risk`, `coverage-gate`, `claim`,
  `red-at-base`, `complexity`, `mutation`, `validation-run` (evidence).
  Added: `shell-writes`, `risk`, `harness-config`, `validation-run`,
  `diff-scope`, `claim`, `util`, `context`, `coverage`, `story`,
  `red-at-base`, `complexity`, `mutation`; the others were already listed.
- **`policy-drift.js`**: decides the `policy-changed` contrary signal (read by
  `claim.js` and `coverage-gate.js`) — added.
- **`hook.js`**: the opt-in pre-push gate; it blocks a push when the latest
  verify is red, missing or stale — a denial, added.
- **`util.js`**: `matchesPattern` decides which blocked or high-risk glob a
  path hits, for the guard and for risk — added. Cost accepted: `util.js` is
  edited often, and each such diff now runs STRICT.
- **`scripts/test-env-guard.js`**: strips `GIT_DIR`/`GIT_WORK_TREE` before the
  suite runs; without it, fixtures commit into the real repository and the
  verify's proof is about the wrong tree — it decides whether a proof is
  honest, added.
- **Review 1 (2026-11-14, FAIL, two P1s) widened the rule** to every local
  module reachable, transitively, from a listed high-risk `bin/lib/` module
  (subdirectories included). That pulled in:
  - `diff-base.js` (required by `diff-scope.js` and `claim.js`): it decides
    the base every risk signal and claim is measured from;
  - `config.js` (required by `policy.js`): it feeds `baseBranch` to
    `diff-base.js`;
  - `spec-drift.js` (required by `coverage-gate.js`): it decides the
    `criteria-changed` / `spec-in-diff` signals that lower a verdict, the
    same reason as `policy-drift.js`;
  - `settings.js` (required by `opencode.js`): it wires the guard hook into a
    project's settings, so it decides whether denials happen at all.
  One explicit exclusion, commented in the test: `harness-report.js`, which
  only prints verdicts computed elsewhere. A required `package.json` is data
  and is not followed.
- **`context.js`**: only constants (package root, cwd), but it is a direct
  require of `evidence.js` and decides which project a verify proves; added
  rather than carving an exception into the test.
- The test checks each path alone through `scoreDiffRisk(...).matchedPaths`,
  so a structural signal cannot mask a path miss.

## Result

- `.coding-flow/harness.json`: 20 paths added to `highRiskPaths` (16, then
  4 after review 1).
- `test/security-core-risk.test.js`: two tests. The first follows local
  requires transitively and fails if a listed module gains a local require
  that is not high-risk; red on `20e3def` (diff-base, config, spec-drift,
  settings). The second pins the named list.

## Out of Scope

- Changing the default `highRiskPaths` shipped to users.
