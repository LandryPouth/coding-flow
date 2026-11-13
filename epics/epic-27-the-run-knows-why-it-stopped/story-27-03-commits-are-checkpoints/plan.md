# Story 27-03 — Plan

## Implementation Context

- **Execution mode**: STANDARD.
- **Likely files**: `bin/lib/run.js`, `bin/lib/run-state.js`, `bin/lib/git-trailers.js` (new), tests `test/git-trailers.test.js` (new).
- **Shared identifiers**: `Coding-Flow-Run` trailer.
- **Search anchors**: `prepare-commit-msg`, `git interpret-trailers`.
- **Scout pre-step**: no.
- **Areas to avoid**: the driver's process invocation (20-01).

## Decisions

- **Stash, never discard**: the maintainer may want the half-done work.

## Test Plan

Temp repos with trailer commits; deleted state; dirty tree after kill.

## Acceptance Traceability

- 1–3 → see the test files above.

## Commands

```bash
npm test
```
