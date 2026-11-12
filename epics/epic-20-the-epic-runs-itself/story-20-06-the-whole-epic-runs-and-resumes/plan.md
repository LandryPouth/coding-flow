# Story 20-06 — Plan

## Implementation Context

- **Execution mode**: STRICT — unattended batch spending money.
- **Likely files**: `bin/lib/run.js`, `bin/lib/drivers/claude.js`,
  `bin/lib/backbone.js` (`parseBackbone`), `bin/lib/run-state.js` (new),
  `bin/lib/usage.js`, tests `test/run.test.js`, `test/run-state.test.js`
  (new), `test/backbone.test.js`.
- **Search anchors**: `parseBackbone`, `flattenStories`, `selectStories`,
  `RUN_DRIVERS`.
- **Scout pre-step**: no.
- **Areas to avoid**: placement internals (20-02 owns them).

## Technical Notes

- Atomic writes: write temp + rename (as `writeJson` does or should).
- Resume must re-run the preflight (machine may have changed).

## Decisions

- **Restart an interrupted phase from its start**: partial agent work is in
  the tree and verify judges it; nothing is assumed.

## Test Plan

Stub agent; kill the driver at each phase; budget and blocked-streak stops;
tree with an independent root.

## Acceptance Traceability

- 1, 3, 4 → `test/run.test.js::epic loop`
- 2, 5 → `test/run-state.test.js::resume`

## Commands

```bash
npm test
```
