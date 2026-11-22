# Story 22-09 — Plan

## Implementation Context

- **Execution mode**: STANDARD.
- **Depends on**: 22-03 (rung detection, category markers), 22-08 (friction
  events count as activity), 21-01 (closed epics from the journal).
- **Likely files**: `bin/lib/ladder.js`, `bin/lib/config.js`
  (`ladder.dormantEpics`), `test/ladder-retire.test.js` (new).
- **Search anchors**: `ladder`, `rung`, `conventions`.
- **Scout pre-step**: no.
- **Areas to avoid**: rewriting the user's convention files — only proposals.

## Technical Notes

- Superseded is computed from rungs already detected by 22-03; dormant from
  the journal's closed-epic events. No new parser.

## Decisions

- **Origin (2026-11-22):** the article the maintainer asked about only adds
  rules. Epic 22's own Why (always-loaded context costs > 20 % for no gain)
  makes removal the missing half of the loop.
- **Window in epics, not days:** a project paused for a month has not
  stopped needing its rules.
- **Keep marker with a reason**, so a kept line is a decision with its
  provenance, like 22-01's.

## Test Plan

Fixture repos with convention lines, gate configs and a journal of closed
epics; `ladder --retire` output and proposal files read from disk.

## Acceptance Traceability

- 1–5 → `test/ladder-retire.test.js`

## Commands

```bash
npm test
```
