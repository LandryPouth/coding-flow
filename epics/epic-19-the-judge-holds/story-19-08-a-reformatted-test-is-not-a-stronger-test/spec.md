# Story 19-08 — A reformatted test is not a stronger test

## User Value

On a high-risk change, the coverage gate asks that a test file be
strengthened alongside the behaviour it changes. Today a test file with no net
assertion change counts as strengthened ("neutral counts as strengthened"), so
a reformat — by hand, or by a fixer such as `prettier --write .` (19-05) —
earns the gate for a change nobody tested. After this story, a test edit
strengthens unless it is provably neutral — it only moves, renames, re-splits
or reformats test code that was already there; a neutral edit is reported for
what it is.

## Requirements

- In `bin/lib/coverage-gate.js`, a changed test file counts as strengthened
  when it adds an identifier, number or operator that the diff did not
  remove from a test file (across all test files of the diff together,
  compared as formatter-proof tokens), with no weakening signal. Strings alone
  never strengthen. Framework markers no longer decide it (decisions of rounds
  3 and 4, plan.md).
- A test file with a neutral change (rename of the file or of a title,
  reformat — real formatter output included — re-split, a test case moved
  into it from another test file) is listed as `neutral` in the gate's
  output and evidence, never as strengthened. What reads as weakened is
  unchanged by this story: the file a test case moved OUT of still reports
  its assertions removed, as before (re-scope, plan.md).
- When every changed test file is neutral, the gate's "test-file" mode does
  not pass; the message names the neutral files and says what would satisfy
  it (new test code that exercises the change, or a measured coverage report).
- The measured-coverage path (lcov, coverage-final.json) is unchanged.

## Acceptance Criteria

- [x] Given a high-risk change and a test file only reformatted, then the
      gate does not pass in test-file mode and names the file as neutral.
- [x] Given the same change and a test file that adds one assertion, then
      the gate passes in test-file mode.
- [x] Given a test file renamed without other change, then it is neutral,
      not weakened; the file a test case is moved into is neutral, and the
      file it left reads as before this story (assertions removed).
- [x] Given a fixer (19-05) that reformats a test file during verify, then
      the result is the same as a hand reformat: neutral, gate not passed.
- [x] Given a measured coverage report, then the verdict is unchanged by
      this story.

## Edge Cases

- A test file that moves assertions between test cases (delta 0, cases
  unchanged): neutral.
- A new test file counts as a test added, as today.

## Out of Scope

- Judging assertion quality (mutation testing is 13-xx and the probe).
