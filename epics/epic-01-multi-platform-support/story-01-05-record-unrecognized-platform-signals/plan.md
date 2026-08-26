# Plan — Story 01-05

## Implementation Context

- **Execution mode**: FAST — small, well-bounded, but touches evidence
  content policy (what's safe to record) so gets a real test pass rather
  than QUICK.
- **Scout pre-step**: no — builds directly on story 1's detection/evidence
  plumbing, no new module surface beyond a signal-capture allowlist.
- **Likely files**: `bin/lib/detect.js` (expose the signals it checked, not
  just the final verdict — needed for the capture), the platform-evidence
  writer from story 1, `bin/lib/report.js` (the `unrecognized` row),
  `docs/DOGFOODING.md` (one added line).

## Technical notes

- Privacy is the load-bearing constraint here: the allowlist is booleans
  only. Write the allowlist as an explicit named constant
  (`KNOWN_SIGNALS = ["CLAUDECODE", ...]`) reviewed in this story's PR, not
  assembled dynamically — a dynamic version is one refactor away from
  accidentally capturing a value instead of a presence check.
- Confirm during implementation (see spec's second acceptance criterion)
  whether a partially-matching signal (dir present, env absent) should ever
  change `resolveTarget`'s verdict — the working assumption is no (story 1's
  resolution order stays as specified), this story only enriches what gets
  *recorded* alongside an `"unrecognized"` verdict.

## Decisions

_(filled during implementation)_

## Test plan

- `test/detect-unrecognized-signals.test.js` (new): known signals present
  vs. absent are captured correctly as booleans; an env var not on the
  allowlist is never captured even if set; no file-content or directory-
  listing capture occurs.
- Extend `test/report-platform-coverage.test.js`: an `unrecognized` row
  appears only when such records exist, shows a correct count and signal
  breakdown, and old records missing a since-added allowlist key render as
  "not checked" rather than erroring.

## Acceptance traceability

| Criterion | Test |
|---|---|
| unrecognized target → no files, evidence recorded | `test/detect-unrecognized-signals.test.js` |
| signal capture is boolean-only, allowlisted | `test/detect-unrecognized-signals.test.js` |
| report shows unrecognized row with counts | `test/report-platform-coverage.test.js` (extended) |
| no row when zero unrecognized records | `test/report-platform-coverage.test.js` (extended) |
| old records with missing key don't error | `test/report-platform-coverage.test.js` (extended) |

## Commands

```
npm test
```
