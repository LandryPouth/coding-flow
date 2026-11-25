# Story 34-01 — The to-do list reads at a glance

## User Value

With 50 items waiting, the maintainer sees first the few that block a deploy,
then how many other tasks and how many unchecked criteria remain, and can set
aside an item that no longer makes sense, with a reason kept in the story.

## Implementation Context

- Files: `bin/lib/todo.js` (scan, `todoCommand`, `todoDoneCommand`), the
  `todo` branch of `bin/ai-flow.js` (~line 876), `next`'s We need you block,
  `test/human-todo.test.js`, README (`What to do next`), CHANGELOG.
- Kinds today: `before: deploy`, `before: later` (Human to-do items) and
  `deferred` (acceptance criteria deferred to a human).
- Execution mode STANDARD (writes a story file on `drop`). Scout: no.

## Acceptance Criteria

- [ ] Given 7 `before: deploy`, 13 `before: later` and 31 `deferred` items, when
      `ai-flow todo` runs, then the first line counts each kind
      (`Waiting on you: 7 before deploy, 13 to do later, 31 to check by hand`),
      the 7 `before: deploy` items are printed in full, and the others are
      summarised in one line each per kind with the command to see them
      (`ai-flow todo --all`).
- [ ] Given the same items, when `ai-flow todo --all` runs, then two sections
      are printed — "To do" (`before: *`, deploy first) and "To check by hand"
      (`deferred`) — each oldest epic first, every item with its id.
- [ ] Given `--json`, when `ai-flow todo --json` runs, then each item carries
      its kind and the totals per kind; existing fields are unchanged.
- [ ] Given an item id, when `ai-flow todo drop <id> --reason "obsolete since
      epic 30"` runs, then the item's line in its story file is ticked and
      marked set aside with the reason and the date (one documented shape), it
      no longer appears in `todo` or `next`, and `--dry-run` prints the change
      and writes nothing.
- [ ] Given `todo drop` without `--reason`, or an unknown id, when it runs, then
      it exits non-zero with one line saying what is missing and writes nothing.
- [ ] Given more than 5 items, when `ai-flow next` prints We need you, then it
      shows the `before: deploy` items and one summary line for the rest, not
      the whole list.

## Commands

```bash
npm test
```

## Result
