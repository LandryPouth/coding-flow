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

## Test Plan

Throwaway repos with a high-risk path, a neutral, an added-assertion and a
renamed test file; a fixer case through 19-05's `validation.fix`.

## Acceptance Traceability

- 1–5 → `test/coverage-gate.test.js` (or the gate's existing test file)

## Commands

```bash
npm test
```
