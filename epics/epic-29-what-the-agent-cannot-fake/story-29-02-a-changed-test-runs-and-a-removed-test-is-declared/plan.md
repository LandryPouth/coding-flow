# Plan — 29-02 A changed test runs, and a removed test is declared

## Implementation Context

- Mode: STANDARD. Scout: no.
- Likely files: new `bin/lib/collected-tests.js` (runner detection, list
  mode, cache), `bin/lib/coverage-gate.js` (`test-not-run`, `test-removed`
  contrary signals next to `scanTestWeakening`), `bin/lib/validation-run.js`
  (reports: declared path, freshness, parse), `bin/lib/config.js`
  (`validation.reports`), `bin/lib/evidence.js` (`collected`), docs.
- Reuse: 19-01's parsers for reports where they overlap (jest JSON, TAP),
  `diff-scope.js` for removed lines, the tree token cache.
- Reference: `~/.claude/workflows/lib/proof-scan.mjs` (`suiteOf`, `scanTests`).

## Decisions

_(to fill)_

## Test plan

- Fixture packages: jest with `testRegex`, jest with `--config` in the
  script, vitest, node:test, unknown runner.
- Removed titles: removal, move, rename of the file, `test.each`.
- Reports: missing, stale (older than the run), empty, failing, good.

## Acceptance Traceability

_(to fill)_

## Commands

```
npm test
npm run lint
```
