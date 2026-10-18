# Story 13-06 — Plan

## Implementation Context

- **Execution mode**: STANDARD.
- **Likely files**: `scripts/check-function-size.js` (new),
  `test/check-function-size.test.js` (new, throwaway git repos with a
  hand-written lcov), `.coding-flow/config.json`; reuse `parseLcov`
  (`bin/lib/coverage.js`) and `diff-scope.js` added-lines helpers if they are
  importable without side effects.
- **Threshold**: 80 lines (repo p90 is ~50; 72 functions are over 50 today,
  20 over 100). Make it a constant at the top of the script.

## Decisions

- **lcov for discovery, braces for the end**: lcov gives function starts in
  any language, but its `FN` record has no end line in Node's output.
  JavaScript brace matching is enough for this repository; 14-07 generalises
  with the next `FN` start as a fallback bound.
- **A ratchet, not a mandate** (study, wave 2): the existing 331-line
  function is not a failure until someone grows it.

## Acceptance Traceability

- criteria 1–4 → `test/check-function-size.test.js`; criterion 5 → this
  story's verify evidence.
