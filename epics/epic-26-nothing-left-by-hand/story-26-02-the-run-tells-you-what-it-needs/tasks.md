# Story 26-02 — Tasks

- [~] notify command from user config, events, timeout, doctor warning (after 24-02; see plan.md *Split*).
- [x] `ai-flow todo` across epics with configurable headings.
- [~] Docs examples (notify-send, PowerShell toast, ntfy) — with the notify half.
- [x] Run `npm test`, then `ai-flow verify --story <this story>`, the review
      the mode requires, and add a CHANGELOG entry.

## Result

Reader half shipped: `bin/lib/todo.js` (one Markdown scanner, `scanMarkdown`,
behind every reader) + `ai-flow todo [--json]`; 23 tests in `test/todo.test.js`,
two of them tables of Markdown shapes (12 to-do-section cases, 10 story cases).
On this repository it lists 10 items: epic 26's three deferred notify criteria
(this story's own `[~]`) and epic 27's seven cleanup items.
Notify half deferred (plan.md *Split*).

### Rollback Notes

## Status: done
