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
- **The base length is derived, not read.** There is no lcov at the base, so a
  function's length at the base is its length now, minus the lines the diff
  added inside it, plus the lines it removed there (from `git diff -U0`
  hunks). One rule covers both cases: it fails when the function ends over 80
  lines and longer than at the base ("crosses 80" and "already over 80 grows").
  A function with no added line has base >= head, so "touched" needs no test of
  its own.
- **A stale lcov is refused**, not trusted: a source file edited after
  `coverage/lcov.info` was written would have its functions attributed to the
  wrong lines. A changed file that the lcov does not list is skipped (it was not
  measured).
- **Test files count too.** No exemption was written into the spec, and the
  check found none of the repository's test functions over the line growing.
- **A ratchet, not a mandate** (study, wave 2): the existing 331-line
  function is not a failure until someone grows it.

## Acceptance Traceability

- criteria 1–4 → `test/check-function-size.test.js`; criterion 5 → this
  story's verify evidence.
