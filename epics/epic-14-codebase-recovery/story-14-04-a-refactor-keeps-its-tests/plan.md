# Story 14-04 — Plan

## Implementation Context

- **Execution mode**: STRICT (a new way for verify to fail).
- **Likely files**: `bin/lib/claim.js` (new, core) or a function in
  `coverage-gate.js` if it stays under ~80 lines; `evidence.js`,
  `harness.js` (flag), `story.js` (`## Claim:` reader), `harness-report.js`,
  `usage.js`; `test/layering.test.js` classification.
- **Reuse**: test-file classification and weakening from `coverage-gate.js`,
  patch coverage from `coverage.measurePatchCoverage`.

## Decisions

- **Modified test = not a refactor**, even for a rename inside a test. The
  developer splits the change: a test-only commit first (proven as
  strengthening), then the refactor. Strict and simple beats a diff
  classifier.
- **First real consumer: `guard.js` `shellWrites`** (331 lines), as a
  follow-up story after this one lands — the claim proven on the tool's
  most complex function (story 15-02).

## Acceptance Traceability

- 1–5 → `test/claim-refactor.test.js`.
