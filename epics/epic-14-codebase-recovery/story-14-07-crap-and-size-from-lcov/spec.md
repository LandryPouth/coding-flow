# Story 14-07 — CRAP and size from lcov: rank the hotspots, stop the growth

## User Value

The recovery scan ranks hotspots by what actually makes code risky to change
— complexity not covered by tests — and `verify` reports when a diff makes a
touched function riskier or longer, in any language whose coverage tool
emits lcov.

## Requirements

- From any lcov report: per function (`FN` start line; end = next `FN`
  start in the file, or brace matching for C-like sources when it gives a
  closer bound), decision points = distinct `BRDA` lines in the range + 1,
  coverage = hit share of `DA` lines; `crap = c² × (1 − cov)³ + c`. Labelled
  **heuristic** in every output (V8 block coverage approximates decisions).
- `recover scan`: when a fresh lcov exists, hotspots gain `crap`, `length`
  for their worst functions, and ranking becomes churn × CRAP; without one,
  today's churn × size, and the scan says which.
- `verify`: functions overlapping the diff's added lines whose CRAP crosses
  30, or whose length crosses `functionSize.max` (default 80) or grows while
  above it, are a **warning** signal `complexity-grew` listing `file:line
  name before→after`. Fails only when `functionSize.enforce: true` in
  `harness.json`.

## Acceptance Criteria

- [ ] Given a hand-written lcov with one function of 10 branch lines and 0 %
      coverage, then its CRAP is 121 and it ranks first.
- [ ] Given the same function fully covered, then CRAP 11.
- [ ] Given a diff growing an 85-line function to 90 with `enforce: false`,
      then a `complexity-grew` warning and verify passes; with `enforce:
      true`, verify fails.
- [ ] Given an lcov from Python's `coverage lcov` (fixture file) for a
      `.py` file, then functions are found with next-`FN` bounds.
- [ ] Given no lcov, then `recover scan` says "ranked by churn × size (no
      coverage report)" and `verify` emits no complexity signal.

## Decisions

- **Supersedes 13-06's repository script for users**; 13-06 stays as this
  repository's enforced ratchet until this lands, then becomes
  `functionSize.enforce: true` here.

## Result
