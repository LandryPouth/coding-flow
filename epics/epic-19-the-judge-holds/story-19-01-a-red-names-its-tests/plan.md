# Story 19-01 — Plan

## Implementation Context

- **Execution mode**: STANDARD — walking skeleton: parser → evidence →
  terminal → journal.
- **Likely files**: `bin/lib/test-failures.js` (new), `bin/lib/util.js`
  (`selectFailureLines`, reuse its ANSI stripping),
  `bin/lib/validation-run.js` (`runValidationCommand`: exit, signal,
  timedOut), `bin/lib/harness.js` / `bin/lib/evidence.js` (printing and
  evidence), `test/failure-lines.test.js`, `test/test-failures.test.js`
  (new) with fixtures under `test/fixtures/runner-output/`.
- **Search anchors**: `selectFailureLines`, `timedOut`, `stdoutTail`,
  `runValidationCommand`.
- **Scout pre-step**: no.
- **Areas to avoid**: verdict computation.

## Technical Notes

- Copy the bethl fixture from `.coding-flow/runs/2026-11-12T01-55-21-583Z-verify.json`
  in bethl (stdout tail of `npm run test -- --force`), trimmed and with paths
  made relative.
- `spawnSync` gives `signal`; a timeout is already flagged by
  `runValidationCommand`.

## Decisions

- **Parsers per runner, not one regex**: each reporter's shape is pinned by a
  fixture; unknown output stays unknown.

## Test Plan

Fixture-driven unit tests; one verify integration test with a failing
node:test file.

## Acceptance Traceability

- 1–2, 5 → `test/test-failures.test.js`
- 3 → `test/command-timeout.test.js::stop cause`
- 4 → `test/harness-verify.test.js::red names its tests`

## Commands

```bash
npm test
```
