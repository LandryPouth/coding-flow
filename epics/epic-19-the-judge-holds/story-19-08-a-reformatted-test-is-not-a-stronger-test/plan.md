# Story 19-08 — Plan

## Implementation Context

- **Execution mode**: STANDARD (the gate decides what proves a story).
- **Depends on**: 19-05 (fixers; its review moved this case here).
- **Likely files**: `bin/lib/coverage-gate.js`, `test/coverage-gate*.test.js`,
  `docs/rules-and-limits.md`.
- **Search anchors**: "Neutral counts as strengthened", `strengthened`,
  `assertionDelta`.
- **Scout pre-step**: no.

## Decisions

- **Origin (2026-11-23):** 19-05's third review found that a fixer
  reformatting an unrelated test earned the gate; the run's first answer
  (excluding fixer-touched files) made proof depend on run state and failed
  its fourth review. The gate's own rule is the cause, and a hand reformat
  exploits it too: fixed here, for both.
- **Behaviour change:** some stories that passed in test-file mode on a
  neutral edit will need a real assertion or a coverage report. Listed under
  Behaviour changes in the CHANGELOG.

- **What strengthens (2026-11-24):** a changed test file that is new
  (`addedFilesInDiff`, status `A`), or whose diff adds an assertion (net > 0)
  or a test case (net > 0), with no skip added. A test case is read from its
  declaration: `it|test|specify(` followed by a title string (so a helper
  called `test(` inside a case is not a case), `def test_`, `func Test…(`,
  `@Test`, `#[test]`. Anything else not weakened is `neutral`.
- **Occurrences, not lines:** assertion and skip markers are now counted per
  occurrence. Counting lines made a formatter that splits two assertions
  written on one line read as one assertion added — the very reformat this
  story must call neutral — and joining them read as one removed (a false
  weakening). Same markers, same patterns.
- **Neutral is reported, not punished:** `coverage.neutralTests` lists the
  scan's neutral files plus any changed test file the scan saw no text change
  in (a pure rename, a binary snapshot). Verify prints them under "Tests
  changed without a new test or assertion (neutral)". They never become a
  finding, so the claim (`claim.js`) and weakening signals are unchanged.
- **Only the test-file rung changed:** the measured path still receives the
  not-weakened test files (strengthened + neutral) for its "test file changed
  in their package" rule, exactly the set it had before. The removed branch
  is the one that passed "N test file(s) changed alongside" when nothing was
  weakened: it was the neutral pass.
- **Tests changed on purpose:** `weakened-tests.test.js` "a neutral edit is
  not a weakening" kept every assertion that it is not a weakening; its exit
  code assertion went 0 → 1, which is this story's rule. In
  `harness-fixers.test.js`, 19-05's "a fixer's rewrite counts as the story's
  diff" asserted that a fixer's reformat counted as strengthened (the rule
  19-05 handed here); it now asserts neutral and not proven, by a fixer and by
  hand alike (criterion 4). The fixer-strengthened warning moved to a new test
  whose fixer really adds an assertion, and the outside-root path-form test's
  fixer adds an assertion too, so both still exercise `fixerStrengthened`.

## Test Plan

Throwaway repos with a high-risk path, a neutral, an added-assertion and a
renamed test file; a fixer case through 19-05's `validation.fix`.

## Acceptance Traceability

- 1–5 → `test/weakened-tests.test.js`, `test/harness-fixers.test.js` (see tasks.md)

## Commands

```bash
npm test
```
