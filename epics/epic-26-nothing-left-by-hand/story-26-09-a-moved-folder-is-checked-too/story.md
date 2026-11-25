# Story 26-09 — A moved folder is checked too

Split from 26-03 at its review cap (round 4 on real docs). Not new scope:
the folder half of what 26-03 checks file by file.

## Acceptance Criteria

- [ ] Given a doc that names only a folder (`packages/geo`), when that folder is moved or deleted and `docs check --changed <base>` runs, then the doc is read and its stale mention reported, as the full check does. (A mention matches when a changed path starts with the mention plus `/`.)
- [ ] Given a path under a folder git recorded as moved (`packages/geo/dist`), then it is judged even when it is git-ignored, and the suggestion names the new folder.
- [ ] Given a backticked branch name in a doc (`docs/complete-documentation` after "Branch" / "Branche", or matching a local or remote branch), then it is not reported as a missing path.
- [ ] Given this repository and bethl's docs (read-only copy), then no finding appears that 26-03 did not report, other than the folder mentions above.

## Commands

```bash
npm test
```

## Status: planned

## Result
