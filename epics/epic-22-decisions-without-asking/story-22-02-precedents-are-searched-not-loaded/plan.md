# Story 22-02 — Plan

## Implementation Context

- **Execution mode**: STANDARD.
- **Likely files**: `bin/lib/decisions.js` (new), `bin/lib/decide.js`,
  `bin/lib/audit.js` (`--decisions`), the fuzzy matcher if one exists (search
  `fuzzy`), `.gitattributes` template (union merge),
  `templates/.claude/skills/flow-run/SKILL.md`, tests
  `test/decisions.test.js` (new), `test/audit.test.js`.
- **Search anchors**: `DECISIONS.md`, `merge=union`, `Co-Authored-By`.
- **Scout pre-step**: no.
- **Areas to avoid**: `docs/DECISIONS.md` output format.

## Technical Notes

- Agent authorship: `Co-Authored-By: Claude` trailers or the driven run's
  commit marker.

## Decisions

- **Search, never preload**: research result; also limits poisoning.
- **Only accepted precedents lower a level**: "agent proposes, human
  promotes".

## Test Plan

Registry fixtures; decide lowering matrix; audit import with authored
commits.

## Acceptance Traceability

- 1–5 → `test/decisions.test.js`, `test/audit.test.js::import`

## Commands

```bash
npm test
```
