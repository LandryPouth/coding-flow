# Story 21-06 — Plan

## Implementation Context

- **Execution mode**: STANDARD.
- **Likely files**: `bin/lib/escapes.js` (new, reads `git log`),
  `bin/lib/insights.js`, `bin/lib/events.js` (incident), tests
  `test/escapes.test.js` (new).
- **Search anchors**: `worktree.land`, `git log`, `spawnSync('git'`.
- **Scout pre-step**: no.
- **Areas to avoid**: land itself.

## Technical Notes

- One `git log --name-only --since` pass, bounded by the oldest landed story in
  range.

## Decisions

- **Heuristic, labelled**: false positives are acceptable if visible; a silent
  zero is not.

## Test Plan

Temp git repos with dated commits (`GIT_COMMITTER_DATE`).

## Acceptance Traceability

- 1–3 → `test/escapes.test.js`
- 4 → `test/insights.test.js::yield with escapes`

## Commands

```bash
npm test
```
