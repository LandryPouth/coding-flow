# Story 17-03 — Tasks

- [x] Tests first: the next number across disk, index and branches; the two
      new warnings; no warning for the same slug; a repository with no
      remote.
- [x] `epic-numbers.js`; the `status --json` fields; the print on
      `archive --refresh`; the doctor checks.
- [x] Add the `/flow-plan` Conventions line, update the evals, run
      `plugin sync`.
- [x] Run `npm test`, `ai-flow verify`, the review, and add a CHANGELOG
      entry (Added).

## Result

- `bin/lib/epic-numbers.js` (layer module): `epicNumbers(root)` scans the disk,
  the archived entries and every other local and remote-tracking ref (`git
  for-each-ref`, then `git ls-tree <ref> -- epics/`, argument arrays only, cap
  200); `epicNumberCollisions` gives doctor its two warnings.
- `status --json`: `nextEpicNumber` and `nextEpicNumberSources` (`git`,
  `directories`, `archivedEntries`, `refs`, `refLimit`, `refsCapped`,
  `remoteRefsAsOfLastFetch`, `lastFetch` from `FETCH_HEAD`'s mtime).
- `archive --refresh` prints `Next epic number: NN.` (and `nextEpicNumber` in
  `--json`); `doctor --fix` stays quiet.
- `doctor`: `archived_epic_number_reused`, `epic_number_on_other_branch`.
- `/flow-plan` Conventions names `nextEpicNumber`; eval case added; plugin synced.
- Tests: `test/epic-numbers.test.js` (13), red first at `24b753c`.

### Rollback Notes
