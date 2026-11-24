# Story 19-08 — A reformatted test is not a stronger test

## User Value

On a high-risk change, the coverage gate asks that a test file be
strengthened alongside the behaviour it changes. Today a test file with no net
assertion change counts as strengthened ("neutral counts as strengthened"), so
a reformat — by hand, or by a fixer such as `prettier --write .` (19-05) —
earns the gate for a change nobody tested. After this story, only a test file
that adds a test or an assertion strengthens; a neutral edit is reported for
what it is.

## Requirements

- In `bin/lib/coverage-gate.js`, a changed test file counts as strengthened
  only when it adds at least one test case or assertion (net assertion delta
  > 0, or a new test case), with no skip added.
- A test file with a neutral change (rename, reformat, typo) is listed as
  `neutral` in the gate's output and evidence, never as strengthened and
  never as weakened.
- When every changed test file is neutral, the gate's "test-file" mode does
  not pass; the message names the neutral files and says what would satisfy
  it (a new assertion, or a measured coverage report).
- The measured-coverage path (lcov, coverage-final.json) is unchanged.

## Acceptance Criteria

- [ ] Given a high-risk change and a test file only reformatted, then the
      gate does not pass in test-file mode and names the file as neutral.
- [ ] Given the same change and a test file that adds one assertion, then
      the gate passes in test-file mode.
- [ ] Given a test file renamed without other change, then it is neutral,
      not weakened.
- [ ] Given a fixer (19-05) that reformats a test file during verify, then
      the result is the same as a hand reformat: neutral, gate not passed.
- [ ] Given a measured coverage report, then the verdict is unchanged by
      this story.

## Edge Cases

- A test file that moves assertions between test cases (delta 0, cases
  unchanged): neutral.
- A new test file counts as a test added, as today.

## Out of Scope

- Judging assertion quality (mutation testing is 13-xx and the probe).
