# Story 13-06 — A touched function does not grow past the line

## User Value

Debt in this repository stops growing without a big-bang refactor: a
function a diff touches may not end the diff longer than the threshold
unless it already was, and an already-long function may not get longer.

## Requirements

- `scripts/check-function-size.js`, zero-dependency, declared in this
  repository's `validation.quality` (next to
  `check-lock-exit-reachability.js`):
  - functions from the fresh `coverage/lcov.info` (`FN` start lines, story
    13-03), end found by brace matching in the source (JavaScript here);
  - for each function overlapping the diff's added lines (diff base as
    `verify` resolves it): length at base vs HEAD;
  - fails when a touched function crosses 80 lines, or when a function
    already over 80 grows; prints `file:line name base→head`.
- Grandfathered: long functions not touched by the diff are never reported.

## Acceptance Criteria

- [ ] Given a diff that adds 5 lines to a 78-line function, then the check
      fails naming it (78→83).
- [ ] Given a diff that adds 2 lines to the 331-line `shellWrites`, then it
      fails (331→333); removing lines from it passes.
- [ ] Given a diff that does not touch any long function, then it passes,
      whatever the repository's long functions.
- [ ] Given no `coverage/lcov.info`, then it fails with "run the lcov
      validation first" (never a silent pass).
- [ ] Wired into `.coding-flow/config.json` `validation.quality`; `ai-flow
      verify` runs it.

## Out of Scope

- Users' projects and other languages: story 14-07 (CRAP and size from
  lcov, any language that emits `FN`).

## Result
