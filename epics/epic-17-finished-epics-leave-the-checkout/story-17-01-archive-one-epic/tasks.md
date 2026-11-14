# Story 17-01 — Tasks

- [x] Scout: how `status`, `next`, `audit` and `trace` treat evidence whose
      story directory no longer exists.
- [x] Tests first, in `test/archive.test.js`: the happy path, the recovery
      round trip, each refusal, `--dry-run`, idempotence, the proof state
      recorded as it stands, orphan evidence, the link listing.
- [x] `bin/lib/epic-index.js` (the archived section only), then
      `bin/lib/archive.js`, then the dispatch and the help.
- [x] Add the design-decisions entry for the command.
- [ ] Run `npm test`, `ai-flow verify`, then an independent review (STRICT),
      and add a CHANGELOG entry (Added).

## Result

- `ai-flow archive <epic-dir | NN> [--dry-run] [--json]`: `bin/lib/archive.js`
  (command), `bin/lib/epic-index.js` (the archived section of
  `epics/INDEX.md`, reused by 17-02/17-03), dispatch in `bin/ai-flow.js`,
  help in `bin/lib/usage.js`, README command table, design decision 18,
  CHANGELOG (Added).
- `bin/lib/audit.js`: `audit --check` and the review summary skip evidence of
  a story no longer on disk (the scout found the gate failing on it).
- `test/archive.test.js`: 15 behavioural tests on throwaway repositories,
  red first (commit `6b10c97`). `test/layering.test.js` classifies the two
  new modules as layer.

### Rollback Notes

Revert the story's commits: the command is new, and the only change to an
existing path is the `storyStillOnDisk` filter in `bin/lib/audit.js`.
Nothing is migrated; an `epics/INDEX.md` written by the command stays valid
Markdown.

## Status: in-progress
