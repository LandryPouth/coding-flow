# Story 24-06 — Plan

## Implementation Context

- **Execution mode**: STANDARD.
- **Likely files**: `bin/lib/questions.js` (new), `bin/lib/autonomy.js`,
  `bin/lib/decisions.js`, `bin/lib/config.js` (global preferences),
  `bin/lib/next.js`, `templates/.claude/skills/flow-next/SKILL.md`,
  `docs/agent-contract.md`, tests `test/questions.test.js` (new).
- **Search anchors**: `Needs you`, `owner`, `globalConfig`.
- **Scout pre-step**: no.
- **Areas to avoid**: the vault (shares the global config file only).

## Technical Notes

- `Needs you` parsing from 20-05; topic line `Topic: <t>` per question.

## Decisions

- **Preferences are presentation only**: they can never widen autonomy.

## Test Plan

Fixture stories with questions; answer flow; doctor warning.

## Acceptance Traceability

- 1–3 → `test/questions.test.js`
- 4 → `scripts/skill-evals.js`

## Commands

```bash
npm test
```
