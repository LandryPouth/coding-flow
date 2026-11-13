# Story 25-01 — Plan

## Implementation Context

- **Execution mode**: STANDARD.
- **Likely files**: `bin/lib/tiers.js` (19-06), `bin/lib/serve.js` (24-01),
  `bin/lib/harness.js`, `bin/lib/verify-queue.js`, tests
  `test/browser-tier.test.js` (new) with a fixture `node` HTTP server.
- **Shared identifiers**: `validation.tiers.browser`, `serve.ports`,
  `browser.startTimeoutSec`.
- **Search anchors**: `tiersByRisk`, `toolError`, `worktree-processes.json`.
- **Scout pre-step**: no.
- **Areas to avoid**: the checklist judging of 19-06 (kept as is).

## Decisions

- **No browser in the package**: the fixture is an HTTP server and a `node`
  script calling `fetch(BASE_URL)`; a real project brings its own tool.

## Test Plan

Fixture app; failing command; dead server; occupied port.

## Acceptance Traceability

- 1–4 → `test/browser-tier.test.js`

## Commands

```bash
npm test
```
