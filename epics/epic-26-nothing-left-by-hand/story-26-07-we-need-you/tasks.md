# Story 26-07 — Tasks

- [ ] Discovery: read 26-02's `todo.js` as shipped, `next.js` (`buildQueue`,
      empty message), `ship.js` PR body, guard secret patterns.
- [ ] `## Human to-do` parsing: `when`, derived ids, dedupe story/index,
      masking; `ai-flow todo done <id>` under a file lock.
- [ ] `next`: We need you block above the recommendation, ordering, 5-line cap
      and `later` count, all epics including landed ones, empty-queue message,
      `--json` `needsYou`.
- [ ] `status` header line; `ship` PR body `Before you deploy`; land, autoland
      and closure print.
- [ ] `verify` warning and `doctor` check `todo.uncaptured`
      (`todo.uncapturedPatterns`), `when` and secret checks.
- [ ] Skills `flow-plan`, `flow-run`, `flow-review`, `flow-next` (and template
      copies): write a `## Human to-do` item when a human-only action appears;
      `/flow-next` reports the block verbatim.
- [ ] `docs/rules-and-limits.md`: new rows; README `next` section.
- [ ] Run `npm test`, then `ai-flow verify --story <this story>`, the review
      the mode requires, and add a CHANGELOG entry.

## Result

### Rollback Notes
