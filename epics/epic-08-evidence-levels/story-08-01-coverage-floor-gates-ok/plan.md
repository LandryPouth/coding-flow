# Story 08-01 — Plan

## Implementation Context

- **Execution mode**: STRICT.
- **Likely files**: `bin/lib/coverage.js` (`COVERAGE_TIERS`, `coverageTier`
  ~293 — add `tierRank`), `bin/lib/harness.js` (`evaluateCoverageResult`
  ~2032 — apply the floor after the tier is known; `printVerify` ~1495),
  harness config defaults, `bin/lib/status.js`, `bin/lib/ship.js` (PR body
  evidence section), `bin/lib/audit.js`, tests.
- **Search anchors**: `coverageTier(`, `tier ===`, `printWeakenedTests`.
