# Story 22-05 — Plan

## Implementation Context

- **Execution mode**: STANDARD.
- **Likely files**: `bin/lib/playbooks.js` (new), `bin/lib/insights.js`,
  `bin/lib/story.js` (`Type:`), `bin/lib/vault.js`,
  `templates/.claude/skills/flow-plan/SKILL.md`,
  `templates/.claude/skills/flow-run/SKILL.md`, `test/playbooks.test.js`
  (new).
- **Search anchors**: `Owner:` (same line parsing), `vault.write`.
- **Scout pre-step**: no.
- **Areas to avoid**: the playbook's content quality is the human's call.

## Technical Notes

- Escape data from 21-06; yield from 21-01.

## Decisions

- **Cited, not preloaded**: same reason as 22-02.

## Test Plan

Fixture insights; propose/accept; skill evals for citing.

## Acceptance Traceability

- 1–2, 4 → `test/playbooks.test.js`
- 3 → `scripts/skill-evals.js`

## Commands

```bash
npm test
```
