# Story 12-01 — Plan

## Implementation Context

- **Execution mode**: STRICT.
- **Depends on**: story-07-01 (`resolveDiffBase`); epic-08 floors if landed
  (otherwise today's rules).
- **Likely files**: `bin/lib/harness.js` — the `not evaluated (no single
  story…)` branch (~2291), `evaluateCoverageResult` (~2032: accept
  `storyDir: null`), `combineRisk`/`scoreStoryRisk` callers (story risk
  absent → diff risk only), `findReusableVerify` (~2344); `bin/lib/audit.js`;
  tests on a repo without `epics/`.
