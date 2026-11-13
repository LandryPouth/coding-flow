# Story 13-04 — Plan

## Implementation Context

- **Execution mode**: STANDARD.
- **Likely files**: `bin/lib/harness-config.js` (defaults + read),
  `bin/lib/coverage-gate.js` `evaluateContrarySignals` (~612; mirror
  `readTestExemption` for `## Policy Change`), `bin/lib/harness.js`
  (`--policy-change` flag next to `--test-exemption` ~505),
  `bin/lib/harness-report.js` (print), `bin/lib/usage.js`.
- **Tests**: `test/contrary-signals.test.js` style, throwaway repos.

## Decisions

- **Not judging direction.** Telling a loosened threshold from a tightened
  one needs a parser per format; one declared sentence is cheaper than a
  wrong guess, and entry 9 says the tool never raises a claim on a guess.
- **`policyFingerprint` already detects a `harness.json` change between
  runs**; this signal is about the diff under proof, which the fingerprint
  does not cover.

## Acceptance Traceability

- criteria 1–4 → `test/policy-changed.test.js`

## Decisions (proof, 2026-11-13)

- **Proven with `--base 72dabd5`**, the commit before `2489e3b`: the branch's
  fork point (`develop`) and `develop`'s own recorded `codingFlowBase`
  (`4c7280c`) both lie after the story's code, so neither scope measures it.
  The wide scope (295 files) is the price; `branch.develop.codingFlowBase` is
  left untouched (DOGFOODING 2026-11-10, "verify (proof scope)").
- **The size ratchet held the story's two functions, and the fix is a split,
  not a gate change.** The first verify was NOT PROVEN: `printHelp` 105→106
  (the `--policy-change` line) and `evaluateContrarySignals` 76→94 (this story
  and 13-05's drift both grew it). The reference text moved to a
  `FULL_REFERENCE` constant (help output byte-identical), and the failure
  list moved to `contraryFailures` (same order, same messages; 45 contrary,
  drift and CLI tests green).

## Decisions (independent review, 2026-11-13 — FAIL, fixed)

- **The bar is read at the base.** `policyGlobs` comes from `harness.json` as
  the merge base holds it (`readBaseHarness`, `git show <base>:…`), defaults
  when the base has none; `.coding-flow/harness.json` and `config.json` are
  always listed. A diff that writes `policyGlobs: []` next to
  `minPatchCoverage: 0` is now `policy-changed` and fails under strict. With
  no base at all, the working config is used (nothing to compare against).
  The refactor claim passes its own list (`globs`), already a union that a
  diff cannot shrink.
- **`enforced` reads the base too**: `mode: strict` or
  `failOnContrarySignals` at the base still applies when the diff switches
  them off. It applies to every contrary signal, not only policy-changed —
  stepping down from strict was the same hole for all of them.
- **Renames are not paired** (`--no-renames`): `git mv .eslintrc.json x` is
  the old path leaving.
- **An empty `## Policy Change`** (blanks, or only `<!-- … -->`) gives no
  reason.
- **Test fixtures stopped relying on the hole.** `coverage-floor.test.js`'s
  `setHarness` wrote `policyGlobs: []` into the diff to silence the signal;
  it now commits a floor set before any work into the base (the project's
  standing policy), and leaves a mid-branch edit in the diff.

### Out of scope, recorded

- **The verify cache key ignores `--policy-change`**, as it ignores
  `--test-exemption` (`bin/lib/evidence.js` ~337): a green proof can be
  replayed for a different reason. Earlier and shared defect; not fixed here.
- **Other gates still read `mode` from the working tree** (the coverage
  floor, `resolveCoverageFloor`): only the contrary signals were moved to the
  base. The coverage floor reads `harness.json` as the diff leaves it.
