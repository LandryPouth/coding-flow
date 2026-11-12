# Story 24-05 — Plan

## Implementation Context

- **Execution mode**: STRICT — trust in evidence.
- **Likely files**: `bin/lib/ci.js`, `bin/lib/evidence.js` (claim
  comparison), `bin/lib/validation-run.js` (`resolveValidationCommands`,
  base-branch config), `bin/lib/ship.js` (body section),
  `templates/.github/workflows/coding-flow-verify.yml` (new), tests
  `test/ci.test.js`, `test/ci-claims.test.js` (new).
- **Search anchors**: `ciCommand`, `treeToken`, `storyDigest`,
  `isUnattended`.
- **Scout pre-step**: yes — read `ci.js` and how evidence is located per
  story.
- **Areas to avoid**: local verify behaviour.

## Technical Notes

- Base config: `git show <base>:.coding-flow/config.json`.

## Decisions

- **Base branch defines the checks**: a PR cannot weaken the checks it is
  judged by.

## Test Plan

Fixture repos with forged claims; config changed in the PR; template lint
(YAML keys asserted in a test).

## Acceptance Traceability

- 1–3 → `test/ci-claims.test.js`
- 4 → `test/ci.test.js::workflow template`

## Commands

```bash
npm test
```
