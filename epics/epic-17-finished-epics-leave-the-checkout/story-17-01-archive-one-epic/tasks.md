# Story 17-01 — Tasks

- [ ] Scout: how `status`, `next`, `audit` and `trace` treat evidence whose
      story directory no longer exists.
- [ ] Tests first, in `test/archive.test.js`: the happy path, the recovery
      round trip, each refusal, `--dry-run`, idempotence, the proof state
      recorded as it stands, orphan evidence, the link listing.
- [ ] `bin/lib/epic-index.js` (the archived section only), then
      `bin/lib/archive.js`, then the dispatch and the help.
- [ ] Add the design-decisions entry for the command.
- [ ] Run `npm test`, `ai-flow verify`, then an independent review (STRICT),
      and add a CHANGELOG entry (Added).

## Result

### Rollback Notes
