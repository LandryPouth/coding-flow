# Story 20-05 — Plan

## Implementation Context

- **Execution mode**: STANDARD.
- **Likely files**: `bin/lib/story.js`, `bin/lib/run.js` (`selectStories`),
  `bin/lib/next.js`, `bin/lib/storage/local.js` (`inferStoryStatus` for
  `needs you`), `templates/.claude/skills/flow-plan/SKILL.md`,
  `templates/.claude/skills/flow-next/SKILL.md`, tests `test/run.test.js`,
  `test/next.test.js`, `test/single-file-story.test.js`.
- **Search anchors**: `selectStories`, `Readiness`, `Assumption (unconfirmed)`.
- **Scout pre-step**: no.
- **Areas to avoid**: status precedence beyond the new `needs you` state.

## Technical Notes

- Depends on story 16-01 for the marker's wording; if 16-01 has not landed,
  match the literal `Assumption (unconfirmed)`.

## Decisions

- **Default `human`**: the factory takes only what it was given.

## Test Plan

Selection matrix; Needs-you blocking with an independent sibling; next.

## Acceptance Traceability

- 1–2 → `test/run.test.js::selection`
- 3–4 → `test/run-driver-claude.test.js::needs you`
- 5 → `test/next.test.js::human first`
- 6 → `scripts/skill-evals.js`

## Commands

```bash
npm test
```
