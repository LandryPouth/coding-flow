# Story 17-02 — Tasks

- [x] Tests first: refresh, idempotence, text outside the markers preserved,
      the stale warning, no warning on proof drift, `--dry-run`.
- [x] Live-section generation in `epic-index.js`; `archive --refresh`; the
      doctor check and its `--fix`.
- [x] Add the `/flow-plan` Pipeline and Verification lines, update the evals,
      run `plugin sync`.
- [x] Run `npm test`, `ai-flow verify`, the review, and add a CHANGELOG
      entry (Added).

## Result

`ai-flow archive --refresh` writes `epics/INDEX.md`'s live section between
`<!-- coding-flow:index:start -->` / `<!-- coding-flow:index:end -->`: every epic
on disk (number, title, directory) and every story's number, title and written
status. `archive <epic>` refreshes it after the `git rm`; `doctor` warns
`epic_index_stale` and `doctor --fix` refreshes; `/flow-plan` runs the refresh
(Pipeline step 6, Verification). Tests: `test/epic-index.test.js` (9),
`test/doctor-epic-index.test.js` (4); the 17-01 archive tests pass unchanged.

### Rollback Notes

Revert the story's commits: the live section is a managed block, so an
`epics/INDEX.md` already written keeps its markers and its archived section;
delete the block between the markers by hand if wanted. No data migration.

## Status: done
