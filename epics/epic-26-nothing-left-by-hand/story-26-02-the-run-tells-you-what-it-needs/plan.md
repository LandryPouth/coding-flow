# Story 26-02 — Plan

## Implementation Context

- **Execution mode**: STANDARD — runs a user-declared command.
- **Likely files**: `bin/lib/notify.js` (new), `bin/lib/todo.js` (new),
  `bin/lib/machine-config.js` (24-02), `bin/lib/run.js`, `bin/lib/doctor.js`,
  `bin/ai-flow.js` (command), tests `test/notify.test.js`,
  `test/todo.test.js` (new).
- **Shared identifiers**: `notify.command`, `notify.events`,
  `todo.headings`, `notify.failed`.
- **Search anchors**: `Needs you`, `Owner:`, `[~]`, `withFileLock`.
- **Scout pre-step**: no.
- **Areas to avoid**: 24-06's routing; the `## Human to-do` shape and
  `next`'s block (26-07) — export the reader so 26-07 builds on it.

## Decisions

- **Split (run decision, 2026-11-24): the reader ships first.** `ai-flow todo`
  needs nothing that is not there; `notify.command` lives in the user global
  config, which does not exist until 24-02. This pass ships `bin/lib/todo.js`,
  the `todo` command, `todo.headings` and their tests; the notify criteria are
  `[~]` and owned by the notify half, run after 24-02 (`notify.js`,
  `machine-config.js`, `run.js`, the doctor warning).
- **One reader for 26-07**: `bin/lib/todo.js` exports `collectTodos(root,
  { headings })`, `todoHeadings(config)`, `TODO_KINDS` and
  `DEFAULT_TODO_HEADINGS`. Item kinds: `maintainer`, `needs-you`,
  `human-owner`, `deferred`; each item has `text`, `source`, and `story` when it
  comes from one.
- **Parsing**: a heading counts at any level, case-insensitive; a section ends at
  the next heading of the same or a higher level; headings and list items inside
  fenced code are examples; a line indented under an item continues it. A
  `## Needs you` written as prose is one item. `Owner: human` is read anywhere in
  the story's files; a `done` story is not listed.
- **Round 1 fixes**: code blocks (fenced and 4-space indented) are blanked
  before any section is read; a `## Needs you` keeps its prose paragraphs next
  to its list items; `Owner: human` must be the whole line; deferred criteria
  come from `spec.md`/`story.md` only, outside `## Needs you`; `[]` is
  unchecked; `todo` refuses unknown flags. A done story's `[~]` criteria stay
  listed: the spec lists deferred criteria without excluding done stories, and a
  deferral is still a debt (28-01 also turns them into ideas). Stories under
  `specs/` are not read: `status` and `listEpics` read `epics/` only.
- **Oldest first** = the epic's number (`epic-9` before `epic-10`), then name.

- **stdin JSON, not arguments**: no quoting bugs, no shell injection from a
  story title.

## Test Plan

Fixture notify script writing its stdin to a file; hanging script; project
config attempt; fixture epics with to-dos, Needs you, custom heading.

## Acceptance Traceability

- 1–3 → deferred `[~]` (notify half, after 24-02)
- 4 → `test/todo.test.js::two epics with maintainer to-dos and a Needs you story are all listed, grouped by epic`
- 5 → `test/todo.test.js::a project's own heading set in todo.headings is listed too`

## Commands

```bash
npm test
```
