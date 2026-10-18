# Story 13-05 — Plan

## Implementation Context

- **Execution mode**: STANDARD.
- **Likely files**: `bin/lib/coverage-gate.js` (`evaluateContrarySignals`,
  criteria already passed in as `criteria`), `bin/lib/story.js` (criteria
  parser, reused on the base text), `bin/lib/diff-base.js` (merge base),
  `templates/.claude/skills/flow-plan/SKILL.md`, `evals/cases/flow-plan.json`,
  then `node bin/ai-flow.js plugin sync`.
- **Tests**: `test/acceptance-criteria.test.js` neighbours; throwaway repos
  with a base commit holding the story.

## Decisions

- **Text equality after whitespace normalisation**, not semantic diffing.
  Rewording that keeps the meaning costs one `## Spec Change` sentence.
- **Origin**: `amazingang/old-coder`'s "if no human approved the spec, say
  so" and Martin's Specifier role, done deterministically (Uncle Bob study,
  wave 1).

## Acceptance Traceability

- criteria 1–4 → `test/criteria-drift.test.js`; criterion 5 →
  `test/skill-evals.test.js` + `plugin check`.
