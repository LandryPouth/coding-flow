# Story 26-04 — Plan

## Implementation Context

- **Execution mode**: STRICT — merges into the base unattended.
- **Likely files**: `bin/lib/closure.js` (new), `bin/lib/run.js`,
  `bin/lib/merge-queue.js` (base target, 24-07), `bin/lib/worktree.js`
  (`land --epic`, cleanup), `bin/lib/drivers/claude.js` (closer role),
  `bin/lib/docs-check.js` (26-03), tests `test/closure.test.js` (new).
- **Shared identifiers**: `## Closure`, role `closer`, `docs(epic-NN):
  closure`.
- **Search anchors**: `land`, `autoLandIfChainFinished`, `conflictingFiles`.
- **Scout pre-step**: no.
- **Areas to avoid**: the base queue's own semantics (24-07).

## Decisions

- **Drafts committed, not proposed in a file**: one docs commit is easy to
  read in the land diff and to revert; a proposal file is easy to ignore.
- **Path allowlist checked after the fact**: the closer's tools are limited,
  and the CLI still verifies, because tool lists are configuration.

## Test Plan

Stub closer (good, and one editing `src/`); fixture base moved, red merge,
green land; cleanup observed.

## Acceptance Traceability

- 1–5 → `test/closure.test.js`

## Commands

```bash
npm test
```
