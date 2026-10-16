# Story 07-02 — Tasks

- [x] `filterScopedFiles` + `.coding-flow/**` exclusion + `ignoredPaths`.
- [x] Default harness config gains `ignoredPaths: []`. An existing `harness.json` without the key reads as `[]` through `readHarnessConfig`, so `upgrade` leaves user files alone.
- [x] Doctor hint for large generated directories.
- [x] Tests; `npm test`; verify; CHANGELOG.

## Result

`filterScopedFiles` is the single choke point in `harness.js` for coverage, risk, weakening and deleted-test signals; `doctor` warns with `generated_not_ignored`.

### Rollback Notes

`git revert`; a stray `ignoredPaths` key in `harness.json` is inert without the code.

## Status: done
