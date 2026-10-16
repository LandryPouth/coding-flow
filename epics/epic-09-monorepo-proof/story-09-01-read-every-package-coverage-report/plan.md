# Story 09-01 — Plan

## Implementation Context

- **Execution mode**: STRICT.
- **Likely files**: `bin/lib/coverage.js` — `DEFAULT_REPORT_PATHS` (~25),
  `toRepoRelative` (~124: gains a `base` argument), `loadCoverageReport`
  (~138: becomes `loadCoverageReports` returning a list; keep the old name
  as a wrapper returning the merged result), `coveredExtensions` (~197),
  `measurePatchCoverage` (~214). `bin/lib/harness.js` —
  `evaluatePatchCoverage` (~1805). Tests: `test/coverage.test.js` with
  fixture lcov files in a temp monorepo.
- **Technical notes**: glob expansion with `fs.readdirSync` over `*`
  segments only (zero dependencies; `**` not needed for the defaults — allow
  it in config via the existing `matchesPattern` over a bounded walk).
- Real check on bethl (read-only, in a story worktree): add
  `"coverageReports": ["apps/*/coverage/lcov.info"]` locally, run
  `pnpm --filter api exec jest --coverage` then verify; record the rung.
