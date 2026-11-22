# Story 20-07 — Plan

## Implementation Context

- **Execution mode**: STANDARD.
- **Likely files**: `bin/lib/run.js`, `bin/lib/drivers/claude.js`,
  `bin/lib/run-report.js` (new), `bin/lib/review.js` (epic scope),
  `templates/.claude/skills/flow-review/SKILL.md` (`--epic`), tests
  `test/run-report.test.js` (new), `test/run-driver-claude.test.js`.
- **Search anchors**: `-run.json`, `reviewCapture`, `Maintainer to-do`.
- **Scout pre-step**: no.
- **Areas to avoid**: vault internals (21-02 provides `vault.write`; until
  then a no-op).

## Technical Notes

- bethl epic 39's index already carries a "À faire côté utilisateur" section
  — the report copies such a section verbatim (heading `Maintainer to-do`).

## Decisions

- **One report file per epic, rewritten**, not appended: it is a summary,
  history is in the journal.

## Test Plan

Fixture run state → report snapshot; stub epic reviewer.

## Acceptance Traceability

- 1–2 → `test/run-driver-claude.test.js::epic review`
- 3–4 → `test/run-report.test.js`

## Commands

```bash
npm test
```
