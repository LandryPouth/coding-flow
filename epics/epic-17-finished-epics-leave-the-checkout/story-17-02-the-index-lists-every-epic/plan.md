# Story 17-02 — Plan

## Implementation Context

- **Execution mode**: STANDARD. It writes a managed file inside markers; the
  user's text outside them is never touched.
- **Likely files**:
  - `bin/lib/epic-index.js` (from 17-01): generate and compare the live
    section;
  - `bin/lib/archive.js`: `--refresh`;
  - `bin/lib/doctor.js`: the `epic_index_stale` check, and the `--fix`
    branch next to `checkDuplicateNumbering`;
  - `bin/lib/storage/local.js`: `listEpics` and `storyTitle`;
  - `templates/.claude/skills/flow-plan/SKILL.md` and
    `evals/cases/flow-plan.json`;
  - `test/epic-index.test.js` (new) and `test/doctor.test.js`.
- **Search anchors**: `checkDuplicateNumbering`, `doctor --fix`, the
  `## Status` regex in `inferStoryStatus`.
- **Scout pre-step**: no.
- **Areas to avoid**: `status.js` output. Status stays read-only and does not
  write the index.

## Decisions

- **Written status, not proof status.** Proof status changes on every
  commit; written status changes only when someone edits the story. The file
  stays quiet in diffs, and `doctor` can call it current.
- **A flag on `archive`, not a new command.** The index belongs to the
  archive; a separate command would add a door for one flag.
- **`status` never writes.** It is read-only, so the refresh goes through
  `archive --refresh`, `doctor --fix` and `/flow-plan`.

## Acceptance Traceability

- 1–3, 6 → `test/epic-index.test.js`
- 4–5 → `test/doctor.test.js`
- 7 → `evals/cases/flow-plan.json`

## Commands

```bash
npm test
```
