# Story 26-06 — Plan

## Implementation Context

- **Execution mode**: STANDARD.
- **Likely files**: `bin/lib/rules-registry.js` (new), `bin/lib/config.js`,
  `bin/lib/harness-config.js`, `bin/lib/validation-run.js`,
  `bin/lib/worktree.js`, `bin/lib/doctor.js`, `bin/ai-flow.js`,
  `templates/RULES.md`, `skills/flow-run/SKILL.md`,
  `skills/flow-plan/SKILL.md`, `docs/rules-and-limits.md`, tests
  `test/rules-registry.test.js` (new).
- **Shared identifiers**: `DEFAULT_COMMAND_TIMEOUT_MS`,
  `PER_COMMAND_TIMEOUT_MS`, `coverageFloor`, `failOnContrarySignals`.
- **Search anchors**: `defaultHarnessConfig`, `defaultConfig`, `_MS =`.
- **Scout pre-step**: no.
- **Areas to avoid**: changing values (only where they are defined).

## Decisions

- **The doc is checked, not generated**: prose and sources stay human;
  only the defaults are compared.

## Test Plan

Registry vs doc; effective-value sources; harness defaults written;
budget text compared between template and skill.

## Acceptance Traceability

- 1–6 → `test/rules-registry.test.js`

## Commands

```bash
npm test
```
