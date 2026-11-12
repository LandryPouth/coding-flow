# Story 19-05 — Plan

## Implementation Context

- **Execution mode**: STANDARD.
- **Likely files**: `bin/lib/validation-run.js` (`resolveValidationCommands`),
  `bin/lib/evidence.js` (`executeValidationCommands`), `bin/lib/config.js`,
  `bin/lib/templates.js` (config template), `test/harness-plan-commands.test.js`,
  `test/harness-verify.test.js`.
- **Search anchors**: `validation.quality`, `resolveValidationCommands`,
  `isProjectScriptInvocation`.
- **Scout pre-step**: no.
- **Areas to avoid**: `validation.quality` semantics (stays a check).

## Technical Notes

- bethl declares `npm run lint -- --force` as a quality check; its fixer would
  be `npm run lint -- --fix` (to be declared by the project, not by this story).

## Decisions

- **Fixers before checks, results kept**: the alternative (report-only) keeps
  the red that was the problem.

## Test Plan

Temp repo with a fake fixer script that rewrites a file; failure case; plan
command refusal; dry-run.

## Acceptance Traceability

- 1, 2, 3, 5 → `test/harness-verify.test.js::fixers`
- 4 → `test/harness-plan-commands.test.js::fixers from plan refused`

## Commands

```bash
npm test
```
