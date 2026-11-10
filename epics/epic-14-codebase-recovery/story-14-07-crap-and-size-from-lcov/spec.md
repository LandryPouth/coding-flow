# Story 14-07 — CRAP and size from lcov: rank the hotspots, stop the growth

## Status: done

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

- [x] Given a hand-written lcov with one function of 10 branch lines and 0 %
      coverage, then its CRAP is 132 and it ranks first.
- [x] Given the same function fully covered, then CRAP 11.
- [x] Given a diff growing an 85-line function to 90 with `enforce: false`,
      then a `complexity-grew` warning and verify passes; with `enforce:
      true`, verify fails.
- [x] Given an lcov from Python's `coverage lcov` (fixture file) for a
      `.py` file, then functions are found with next-`FN` bounds.
- [x] Given no lcov, then `recover scan` says "ranked by churn × size (no
      coverage report)" and `verify` emits no complexity signal.

## Decisions

- **Supersedes 13-06's repository script for users**; 13-06 stays as this
  repository's enforced ratchet until this lands, then becomes
  `functionSize.enforce: true` here.
- **A brace source ends at its brace, not at the next `FN`.** Node's lcov lists
  nested callbacks as functions; bounding the outer one at its first callback
  would measure `shellWrites` as a few lines and quietly loosen the ratchet this
  replaces. Brace matching is what 13-06 measured, so a C-like source keeps it;
  other languages use the next `FN`, cut at the first line indented no deeper
  than the definition (a Python `class` between two methods).
- **The base is estimated, not measured**, as 13-06 did: length now minus the
  lines added inside plus those removed; CRAP over the lines the diff did not
  add. No second test run at the base.

## Spec Change

- Criterion 1 read "CRAP is 121". With the formula the requirements fix
  (`c² × (1 − cov)³ + c`, c = 10 branch lines + 1 = 11) a 0 %-covered function
  scores 11² + 11 = 132, and criterion 2's fully covered 11 confirms c = 11; 121
  was c² alone. The number is corrected, the behaviour asked for is unchanged.

## Test Exemption

- `test/check-function-size.test.js` is deleted with the script it tested
  (`scripts/check-function-size.js`, retired by this story). Its brace cases —
  an inline callback measured whole, braces in strings/templates/comments/regexes
  — moved to `test/complexity.test.js`; its ratchet cases (cross 80, grow while
  above it, grandfathered, shrink passes) to `test/complexity-signal.test.js`.

## Policy Change

- `.coding-flow/harness.json` gains `functionSize: { max: 80, enforce: true }`
  and `.coding-flow/config.json` drops `node scripts/check-function-size.js`
  from `quality`: the Decisions below asked for this switch once the signal
  lands. Same limit, same rule (cross 80, or grow while above it), now also
  CRAP over 30.

## Result

- `bin/lib/complexity.js` (new, core): lcov `FN`/`BRDA`/`DA` per function,
  function ends (brace, lcov 2 end, or next `FN` cut by indentation), CRAP, the
  base estimate from the diff, and the `complexity-grew` evaluation.
- `verify`: `complexity` in the evidence when the run wrote an lcov listing
  functions; `ok` requires it under `functionSize.enforce`. Report: a warning
  line on a pass, `NOT PROVEN — … a touched function grew` when enforced.
- `recover scan`: `hotspotRanking` and, with a fresh lcov, `crap` and the three
  worst `functions` per hotspot; the heading names the ranking.
- This repository: `functionSize.enforce: true`; the 13-06 script is removed.
  Its first run here caught `defaultHarnessConfig` growing 80→87 in this very
  diff, fixed by moving the default out.
- Verify: green, `Coverage: verified` (95.4 % of 637 added lines).

### Rollback Notes

- `git revert` of the story commit restores the script and its quality entry.
  No data, no migration; a project that set `functionSize` keeps an ignored key.

