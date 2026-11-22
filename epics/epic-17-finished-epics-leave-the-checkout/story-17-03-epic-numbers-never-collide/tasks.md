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
  for-each-ref`, then one `git cat-file --batch` over `<ref>:<prefix>epics`,
  raw tree bytes, cap 200); `epicNumberCollisions` gives doctor its two
  warnings, one per conflicting epic with every ref that carries it.
- Review (FAIL, 1 P1 + 6 P2), all fixed, red first at `afb819e`: quoted and
  non-ASCII slugs, one batched read, one warning per conflicting epic with a
  `git fetch --prune` hint, `refs` lists contributing refs only (with
  `refsScanned`), detached HEAD, linked worktree, shallow clone and a
  project in a subdirectory are tested.
- `status --json`: `nextEpicNumber` and `nextEpicNumberSources` (`git`,
  `directories`, `archivedEntries`, `refs`, `refsScanned`, `refLimit`, `refsCapped`,
  `remoteRefsAsOfLastFetch`, `lastFetch` from `FETCH_HEAD`'s mtime).
- `archive --refresh` prints `Next epic number: NN.` (and `nextEpicNumber` in
  `--json`); `doctor --fix` stays quiet.
- `doctor`: `archived_epic_number_reused`, `epic_number_on_other_branch`.
- `/flow-plan` Conventions names `nextEpicNumber`; eval case added; plugin synced.
- Tests: `test/epic-numbers.test.js` (20), red first at `24b753c` and `afb819e`.

### Rollback Notes
