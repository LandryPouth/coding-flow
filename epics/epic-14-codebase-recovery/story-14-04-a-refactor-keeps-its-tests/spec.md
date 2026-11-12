# Story 14-04 — A refactor is proven by tests that did not move

## Status: done

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
  5. **code only** (added after independent review): no policy file changed
     (`policyGlobs`, whatever the mode, and no `## Policy Change` clears it),
     no non-behavior file other than prose or type declarations (a test-runner
     or build config, lockfile, generated output, data), and at least one code
     file — hiding a test skips it as surely as editing it.
- Any failed condition → verify fails with `claim: { kind: "refactor", ok:
  false, failures: [...] }`, each failure naming files. A held claim is
  recorded `ok: true` and printed as "refactor: N test files from the base untouched".
- A behavior file in `highRiskPaths` changes nothing in the claim's
  conditions; risk still picks STRICT and review as today.

## Acceptance Criteria

- [x] Given a branch extracting a function with tests untouched and lcov
      covering the moved lines, then the claim holds.
- [x] Given the same branch editing one assertion in an existing test, then
      the claim fails naming that test file.
- [x] Given the same branch with no coverage report, then it fails with the
      "cannot be shown to be exercised" reason.
- [x] Given a new test file added alongside, then the claim still holds.
- [x] Given the claim declared in a story's `## Claim: refactor`, then the
      same evaluation runs without the flag.

## Out of Scope

- Mutation testing of the unchanged tests (wave 5, after this epic) — this
  claim says the tests did not move; mutation would say they pin the code.

## Result

All five criteria are covered by `test/claim-refactor.test.js`, driven through
the CLI on throwaway repositories. Independent review added fail-closed coverage
for pure deletions, a missing merge base, renamed existing tests, reports that
omit the added lines, zero unchanged test files, and the inline `--claim=` form.
