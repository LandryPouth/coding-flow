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
- **Areas to avoid**: 24-06's routing.

## Decisions

- **stdin JSON, not arguments**: no quoting bugs, no shell injection from a
  story title.

## Test Plan

Fixture notify script writing its stdin to a file; hanging script; project
config attempt; fixture epics with to-dos, Needs you, custom heading.

## Acceptance Traceability

- 1–3 → `test/notify.test.js`
- 4–5 → `test/todo.test.js`

## Commands

```bash
npm test
```
