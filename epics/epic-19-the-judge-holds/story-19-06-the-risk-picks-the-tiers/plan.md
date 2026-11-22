# Story 19-06 — Plan

## Implementation Context

- **Execution mode**: STRICT — changes which commands prove a story.
- **Likely files**: `bin/lib/validation-run.js`, `bin/lib/risk.js`,
  `bin/lib/harness-config.js` (`tiersByRisk`), `bin/lib/config.js`,
  `bin/lib/evidence.js`, `bin/lib/story.js` (`## Browser Check`),
  `test/harness-risk.test.js`, `test/verify-command.test.js`.
- **Search anchors**: `resolveValidationCommands`, `riskLevel`,
  `recommendedMode`, `validation.commands`.
- **Scout pre-step**: yes — map every reader of `validation.commands`
  (ci, ship, doctor, run) before changing the shape.
- **Areas to avoid**: coverage gate thresholds.

## Technical Notes

- Builds on 19-05's config shape. `ai-flow ci init` should emit the tiers into
  CI (one line; full CI work is 24-05).

## Decisions

- **Back-compat by aliasing `commands` to `unit`**, no migration required.

## Test Plan

Config fixtures per shape; risk-driven selection; partial tier label; browser
checklist outcomes.

## Acceptance Traceability

- 1–2 → `test/harness-risk.test.js::tiers by risk`
- 3 → `test/verify-command.test.js::legacy commands`
- 4 → `test/verify-command.test.js::single tier is partial`
- 5 → `test/acceptance-criteria.test.js::browser checklist`

## Commands

```bash
npm test
```
