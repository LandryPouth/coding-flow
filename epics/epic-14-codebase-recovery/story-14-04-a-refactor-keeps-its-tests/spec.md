# Story 14-04 — A refactor is proven by tests that did not move

## User Value

When code is restructured, the evidence shows that behavior was held by
**unchanged** tests that still pass and that **reach the moved code** —
so a refactor cannot quietly change behavior by editing the tests that
would have caught it.

## Requirements

- `ai-flow verify --claim refactor` (story or story-less; a story may
  declare `## Claim: refactor` instead). On the diff against its base:
  1. **no existing test file modified or deleted** (`testGlobs`); new test
     files are allowed (characterization tests, expected);
  2. no weakening signal (existing detector);
  3. validation commands green;
  4. **patch coverage from a fresh report** — the added lines executed at ≥
     `minPatchCoverage`; no report → not proven ("a refactor cannot be shown
     to be exercised without a coverage report").
- Any failed condition → verify fails with `claim: { kind: "refactor", ok:
  false, failures: [...] }`, each failure naming files. A held claim is
  recorded `ok: true` and printed as "refactor: behavior held by N unchanged
  test files".
- A behavior file in `highRiskPaths` changes nothing in the claim's
  conditions; risk still picks STRICT and review as today.

## Acceptance Criteria

- [ ] Given a branch extracting a function with tests untouched and lcov
      covering the moved lines, then the claim holds.
- [ ] Given the same branch editing one assertion in an existing test, then
      the claim fails naming that test file.
- [ ] Given the same branch with no coverage report, then it fails with the
      "cannot be shown to be exercised" reason.
- [ ] Given a new test file added alongside, then the claim still holds.
- [ ] Given the claim declared in a story's `## Claim: refactor`, then the
      same evaluation runs without the flag.

## Out of Scope

- Mutation testing of the unchanged tests (wave 5, after this epic) — this
  claim says the tests did not move; mutation would say they pin the code.

## Result
