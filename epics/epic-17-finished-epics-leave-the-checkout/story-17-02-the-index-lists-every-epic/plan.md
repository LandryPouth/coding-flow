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

- **Tests in their own files** (decided while implementing): `test/epic-index.test.js`
  for the refresh, `test/doctor-epic-index.test.js` for the doctor half, instead of
  the existing `doctor.test.js` — the doctor suite is one file per check.
- **The live section is above the archived one.** Without markers, the refresh
  inserts it right before `## Archived epics`; `archive <epic>` keeps appending
  entries at the end, so the two sections never interleave.
- **Broken markers refuse.** A start without an end, an end before a start, or a
  repeated marker: `--refresh` exits 1 and `archive` refuses up front, both writing
  nothing — guessing where the user's text ends could eat it.
- **A symlinked `INDEX.md` refuses** (as 17-01 decided for the archived section).
- **`doctor` judges, `--fix` writes, `status` never does.** The check runs on both
  install shapes, next to the story-link check; `--fix` refreshes before the
  minimal-install early return, since the index is the project's own file.
- **Refresh never stages.** `archive <epic>` stages INDEX.md as 17-01 does; a plain
  refresh leaves the file for the user to commit with the epic change.
- **Story title** drops a leading `Story NN-NN —` (the archived table's rule).
- **Written status** comes from the same regex `inferStoryStatus` used, now shared
  as `writtenStatus()` in `storage/local.js`.

- **Review fixes (2026-11-14):** titles are made inert (`<!--` / `-->` escaped)
  wherever INDEX.md prints them, and archived markers are read only after the
  archived-section marker, so a title can neither end the live section nor forge
  an archived entry. INDEX.md is compared and spliced in LF and written back in
  the line endings it already had. A broken live section warns "fix the markers
  by hand" and `doctor --fix` prints its refusal. A hand-written INDEX.md with no
  markers and no epic on disk is not judged.
- **Refresh on the base branch only (for 17-04 and the run).** The live section
  changes with every written-status flip, so two parallel story branches that
  both refresh conflict on it. Refresh after landing, on the base branch — not
  inside story worktrees.

## Acceptance Traceability

- 1–3, 6 → `test/epic-index.test.js`
- 4–5 → `test/doctor.test.js`
- 7 → `evals/cases/flow-plan.json`

## Commands

```bash
npm test
```
