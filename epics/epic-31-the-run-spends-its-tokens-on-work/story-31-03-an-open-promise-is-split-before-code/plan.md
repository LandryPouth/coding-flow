# Plan — 31-03 An open promise is split before code

## Implementation Context

- Likely files:
  - `bin/lib/doctor.js` or the epic and story checks it calls;
  - a new `bin/lib/open-promise.js` (pure: text and risk in, findings out);
  - `templates/.claude/skills/flow-plan/`, `evals/cases/flow-plan.json`;
  - `docs/rules-and-limits.md` for `plan.openPromisePatterns`;
  - CHANGELOG.
- Search anchors: `checkEpicFiles`, the risk reading of a story (`Risk:` and
  the mode in the plan), and the config registry from 26-06.
- Execution mode: STANDARD. Scout pre-step: no.
- Avoid: the guard; verify.

## Decisions

- D1: a calibration on the run's own history is part of done (criterion 4).
  A heuristic that is not measured is not claimed.
- D2: it warns only on STRICT stories. STANDARD stories rarely ran long, and a
  warning on every "never" would be noise.

## Test Plan

Unit tests on the pure function: the wording, code spans, French, the risk
level. One `doctor` test on a `mktemp -d` project. A calibration script under
`scripts/` reads each long story's spec at its first commit
(`git log --diff-filter=A`) and prints the counts. It is not run by
`npm test`.

## Acceptance Traceability

(filled by `/flow-run`)

## Commands

```bash
npm test
```
