# Plan — 31-04 The run says what it cost

## Implementation Context

- Likely files:
  - a new `bin/lib/run-cost.js`, wired into the CLI;
  - `status` and `next` for the `over budget` mark;
  - `docs/rules-and-limits.md` for the two keys;
  - test fixtures under `test/fixtures/transcripts/`;
  - CHANGELOG.
- Search anchors:
  - how `status` builds a story line;
  - the config registry (26-06);
  - the 2026-11-25 measurement script, whose logic is in
    `docs/plans/autonomous-run.md`'s log.
- Execution mode: STANDARD. Scout pre-step: no.
- Avoid: the guard; anything that writes outside `.coding-flow/runs/`.

## Decisions

- D1: the transcripts are read in place, with a streaming line reader. They
  can be hundreds of MB, as in this run's 110 MB session folder.
- D2: roles are read from agent descriptions, as the run names them. It is a
  heuristic and the report says so, with the unassigned count.
- D3: the default budget comes from the run's own numbers. The median story
  was well under 60 M input tokens; the long stories were 95 to 147 M.

## Test Plan

`node:test` with fixture transcripts in a temporary `HOME` (two projects, two
stories, a truncated line, a marker string in the message content), a budget
crossing seen through `status`, and the no-folder case.

## Acceptance Traceability

(filled by `/flow-run`)

## Commands

```bash
npm test
```
