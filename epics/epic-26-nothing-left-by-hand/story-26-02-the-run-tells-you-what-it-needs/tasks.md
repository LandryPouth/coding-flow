# Story 26-02 — Tasks

- [~] notify command from user config, events, timeout, doctor warning (after 24-02; see plan.md *Split*).
- [x] `ai-flow todo` across epics with configurable headings.
- [~] Docs examples (notify-send, PowerShell toast, ntfy) — with the notify half.
- [ ] Run `npm test`, then `ai-flow verify --story <this story>`, the review
      the mode requires, and add a CHANGELOG entry.

## Result

Reader half shipped: `bin/lib/todo.js` + `ai-flow todo [--json]`, 10 tests in
`test/todo.test.js`. On this repository it lists epic 27's seven cleanup items.
Notify half deferred (plan.md *Split*).

### Rollback Notes

## Status: in-progress
