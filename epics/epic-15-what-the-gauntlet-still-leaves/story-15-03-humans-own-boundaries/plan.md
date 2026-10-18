# Story 15-03 — Plan

## Implementation Context

- **Execution mode**: STANDARD. Depends on 13-04.
- **Likely files**: `templates/.claude/skills/flow-plan/SKILL.md`,
  `evals/cases/flow-plan.json`, `bin/lib/bootstrap.js` (recipes next to
  14-06's security recipes — share the table), `bin/lib/harness-config.js`
  (`policyGlobs`), `templates/.claude/skills/flow-recover/SKILL.md`.

## Decisions

- **No native import checker** (study, *Refused*): path aliases and one
  parser per language; the project's own tool does it better.
- **Approval is a recorded name, not a gate the tool enforces**: the
  readiness gate reads it; the tool cannot know who is human.

## Acceptance Traceability

- 1 → skill evals + `plugin check`; 2–3 → `test/bootstrap.test.js`;
  4 → `test/policy-changed.test.js`.
