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
- **The base length is measured, CRAP at the base estimated.** The function's
  start is mapped through the diff's hunks into the base file (`git show`,
  renames followed) and measured there with the same end rule, so a hunk that
  straddles a function edge or a moved file cannot fake growth or hide it. There
  is no base coverage: CRAP at the base is computed over the lines the diff did
  not add, an added branch line counting as new only beyond the decision-like
  lines (`if`, `for`, `while`, `case`, `catch`, `?`, `&&`, `||`) the diff
  removed there — an edited condition is not a new decision.
- **Under `enforce`, a check that could not run is not a pass.** No lcov from
  this run listing a function, or a failed `git diff`, fails verify when
  `functionSize.enforce` is on (13-06 refused the same way); without it there is
  no signal. An unreadable untracked file is skipped, not a reason to stop.
- **V8's quirks are read, not trusted**: `<instance_members_initializer>` is not
  a function (it would measure a whole class), and a `BRDA` on a function's own
  start line — V8 writes one per function — is not a decision.
- **Brace matching only where it holds**: JavaScript/TypeScript (return types and
  generic constraints skipped), the C family, C#, Java, Go, Dart, PHP. Kotlin,
  Scala, Swift and Rust use the next `FN`; a brace that never closes falls back
  to it too.
- **A file no test loaded still ranks** in `recover scan`, by its size: the lcov
  does not list it, which makes it the riskiest file, not the least.

## Spec Change

- Criterion 1 read "CRAP is 121". With the formula the requirements fix
  (`c² × (1 − cov)³ + c`, c = 10 branch lines + 1 = 11) a 0 %-covered function
  scores 11² + 11 = 132, and criterion 2's fully covered 11 confirms c = 11; 121
  was c² alone. The number is corrected, the behaviour asked for is unchanged.
- Requirements said brace matching applies "when it gives a closer bound"; it
  applies whenever the source is brace-delimited and the brace closes (see
  Decisions), since the next `FN` is a nested callback's start in JavaScript.
- Criterion 4's fixture (`test/fixtures/complexity/coverage-py.lcov`) is
  hand-written in lcov 1 form (`FN:start,name`), not captured from coverage.py —
  PyPI was unreachable from the sandbox. lcov 2's `FN:start,end,name`, which
  recent coverage.py may write, is read as written and tested separately.

## Test Exemption

- `test/check-function-size.test.js` is deleted with the script it tested
  (`scripts/check-function-size.js`, retired by this story). Its brace cases —
  an inline callback measured whole, braces in strings/templates/comments/regexes
  — moved to `test/complexity.test.js`; its ratchet cases (cross 80, grow while
  above it, grandfathered, shrink passes) to `test/complexity-signal.test.js`.

## Policy Change

- `.coding-flow/harness.json` gains `functionSize: { max: 80, enforce: true }`
  and `.coding-flow/config.json` drops `node scripts/check-function-size.js`
  from `quality`: the Decisions above asked for this switch once the signal
  lands. Same limit, same rule (cross 80, or grow while above it), now also
  CRAP over 30, and still never a silent pass without an lcov. One thing is
  lost: the script ran as a quality command in `land`'s re-verify, which skips
  the diff-derived gates; the story's own verify is now the only place it runs.

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
- Independent review (fresh agent) failed the first version: five wrong verdicts
  under `enforce` reproduced (a moved file, an unreadable untracked file switching
  the check off, edited branch lines read as new, hunks straddling a function
  edge, a TypeScript return type), plus V8 class initializers and entry BRDA,
  brace scanning outside JavaScript, and untested files ranked last. All fixed,
  each with a test that fails on the first version (12 tests).
- `/flow-review` (2026-11-10) passed with one P2 and two P3, all fixed:
  - under `enforce`, a touched file the lcov does not list was skipped silently.
    It is now `unlisted` (a language the lcov covers, inside a package a report
    speaks for — the coverage gate's containment rule — not a test or
    `nonBehaviorGlobs`, lines added): a warning, a failure under `enforce`. A
    loaded file with no function (a data module) is kept in the report, so it is
    not mistaken for one no test loaded;
  - `recover scan` weighted a file no test loaded by its line count against
    CRAP for the rest, so any untested file outranked a 132-CRAP function. A
    source the lcov could have listed now gets an estimated CRAP (decision-like
    lines at 0 % coverage, the whole file as one function: an upper bound),
    printed `CRAP ≈ N (estimated)`; a test file or another language gets none and
    is listed after the scored files, so lines and CRAP never share a ranking;
  - an unusable `functionSize.max` silently became 80; the report now names it,
    and uses the stricter of 80 and what it meant.
  - A second, independent review (fresh agent, artifact and contract only) of
    these fixes found the package scope (another package's file failing verify
    under `enforce`), test files estimated and ranked first, and the field name
    clashing with `coverage.patch.unmeasured` (now `unlisted`); all fixed with a
    test each. The verify of the fixes caught `printRecoveryScan` growing past 80
    lines; the hotspot line moved to `describeHotspot`.
- Verify: see the latest `-verify.json`.

### Rollback Notes

- `git revert` of the story commit restores the script and its quality entry.
  No data, no migration; a project that set `functionSize` keeps an ignored key.

