# Story 19-01 — A red names its tests

## User Value

A red verify says which tests failed, in which file, with the first line of
the error, and why a command stopped (exit code, signal, timeout, out of
memory) — in the terminal, in the evidence and in the journal. Today it says
`Failed: @workspace/clips#test` and the agent opens a 300 KB evidence file or
reruns (bethl bilan P1: "un rouge nomme les tests en échec, pas
`Failed: web#test`").

## Requirements

- A failure parser `bin/lib/test-failures.js` reads a command's captured
  output and returns `[{ runner, file, test, message }]` for:
  node:test (spec and TAP), jest, vitest, and turbo's `<package>:<task>:`
  prefixed output (package kept as a field). Unknown output yields an empty
  list, never a guess.
- Stop cause per command: `exit` (code), `signal` (name), `timeout` (the
  configured limit), `oom-suspected` (exit 137, or 143 with no timeout and a
  signal from outside), recorded as `stopCause`.
- `verify` prints, under each red command, up to 10 failures
  (`file › test — message`) and the stop cause; the evidence holds all of
  them; `verify.end` (18-01) carries the failure list without messages longer
  than 200 characters.
- `--json` exposes the same list.
- Fixtures from real output: bethl's turbo + vitest red of 2026-11-12
  (`use-clips-feed.test.tsx › fetches a first page when SSR delivered an empty
  list — expected null to be 'page-2'`), a jest failure, a node:test failure.

## Acceptance Criteria

- [ ] Given the bethl turbo/vitest fixture, when it is parsed, then the
      failure names `src/dom/__tests__/use-clips-feed.test.tsx`, the test
      title and the assertion line, with package `@workspace/clips`.
- [ ] Given jest and node:test fixtures, when parsed, then file, test and
      message are extracted.
- [ ] Given a command killed by timeout, when verify ends, then the stop
      cause is `timeout` with the limit; given exit 137, it is
      `oom-suspected`.
- [ ] Given a red verify, then the terminal shows the failures under the red
      command, and the evidence and `--json` hold the full list.
- [ ] Given output no parser recognises, then the failure list is empty and
      the existing tail is printed as today.

## Edge Cases

- ANSI colour codes and turbo prefixes are stripped before parsing.
- Thousands of failures (a broken setup): cap the stored list at 200 with a
  count of the rest.

## Out of Scope

- Retrying (19-02); classifying flakiness.
