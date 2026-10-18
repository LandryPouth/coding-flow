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
