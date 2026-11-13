# Story 25-02 — Plan

## Implementation Context

- **Execution mode**: STRICT — credentials handed to an agent process.
- **Likely files**: `bin/lib/drivers/claude.js` (walker invocation),
  `bin/lib/run.js`, `bin/lib/browser-walk.js` (new), `bin/lib/tiers.js`,
  `bin/lib/config.js` (`testAccounts`), tests `test/browser-walk.test.js`
  (new) with a stub `claude`.
- **Shared identifiers**: `testAccounts`, `browser.walk.*` events,
  `## Browser Check` item format.
- **Search anchors**: `Browser Check`, `observed`, `--allowedTools`.
- **Scout pre-step**: yes — how a headless `claude -p` loads a browser MCP
  server on the installed version.
- **Areas to avoid**: the implementer's prompt (only its retry input
  changes).

## Decisions

- **The CLI writes the observed lines**: the walker has no edit tools, so
  its verdict cannot be mixed with code changes.
- **One retry for a not-confirmed item**: the same bound as a red test; a
  UI that keeps failing a human-readable check needs a person.

## Test Plan

Stub walker reports (all observed, one not confirmed, crash); prompt and
events scanned for a fake credential value; undeclared role.

## Acceptance Traceability

- 1–5 → `test/browser-walk.test.js`
- 6 → manual, `## Result`

## Commands

```bash
npm test
```
