# Story 13-01 — Plan

## Implementation Context

- **Execution mode**: STRICT (changes verdicts for existing users).
- **Scout pre-step**: no.
- **Likely files**: `bin/lib/coverage-gate.js` — the `behaviorFiles` filter
  (~340–356) and its `mode: "none"` return; `bin/lib/harness-config.js`
  (`defaultNonBehaviorGlobs`, `highRiskPaths` defaults, read only);
  `bin/lib/risk.js` (read only: confirm no change in levels).
- **Tests**: a new `test/migrations-are-behavior.test.js` on throwaway repos,
  modelled on `test/storyless-verify.test.js` (CLI + git, `mktemp -d`).
- **Avoid**: changing the default glob lists themselves (Decision below).

## Decisions

- **Overlap rule in code, lists untouched.** "High-risk ⇒ behavior" fixes
  every existing install without rewriting their `harness.json`; editing the
  defaults would only fix new installs.
- **A user who lists a path as non-behavior and not as high-risk keeps it
  non-behavior**: the rule only applies to files matching both lists.

## Test Plan

Each acceptance criterion is one test; the failing-first replay is the
2026-10-18 DOGFOODING row (`DROP COLUMN` → green), which must fail on the old
code.

## Acceptance Traceability

- criteria 1–5 → `test/migrations-are-behavior.test.js`
