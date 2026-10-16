# Story 08-01 — Plan

## Implementation Context

- **Execution mode**: STRICT.
- **Likely files**: `bin/lib/coverage.js` (`COVERAGE_TIERS`, `coverageTier`
  ~293 — add `tierRank`), `bin/lib/harness.js` (`evaluateCoverageResult`
  ~2032 — apply the floor after the tier is known; `printVerify` ~1495),
  harness config defaults, `bin/lib/status.js`, `bin/lib/ship.js` (PR body
  evidence section), `bin/lib/audit.js`, tests.
- **Search anchors**: `coverageTier(`, `tier ===`, `printWeakenedTests`.

## Result

`coverageFloor` (per risk, mode defaults) gates `ok` in `evaluateCoverage`; a blocked
run keeps `tier: missing` and carries `floor: { required, reached }`. Evidence stores
the resolved floor and `findReusableVerify` requires it to match, so editing the floor
or mode re-runs verify. `status --json` exposes `coverageTier`; `audit` counts runs per rung.
Independent review found the stale-reuse hole and the mislabelled tier; both fixed with tests.

### Rollback Notes

`git revert` of the story commit. Evidence written with a `coverageFloor` field is
ignored by older readers.

### Known gaps

- No end-to-end test for the `medium` floor or for pre-floor evidence through `ship`/`run`
  (covered by unit assertions and pre-existing tier tests).
- `status` shows no `coverageTier` for old evidence without a stored tier only if the
  latest run file lacks coverage entirely.
