# Plan — 32-01 A ledger of every run

## Implementation Context

- Likely files:
  - `evals/bench/ledger.js`, starting from `evals/bench/seed-extract.js`,
    which already reads all three sources;
  - `evals/bench/lib/*.js` if it grows;
  - `test/bench-ledger.test.js`, with fixtures under
    `test/fixtures/bench/`;
  - `evals/README.md`.
- Search anchors:
  - `seed-extract.js` (`readTranscript`, `openCode`, `evidence`);
  - the vault contract in `~/dev/.ai-memory-vault/AGENTS.md`.
- Execution mode: STANDARD. Scout pre-step: no.
- Avoid: `bin/`, `templates/`, `package.json` `files`. Nothing here ships.

## Decisions

- D1: it lives in `evals/`, which is not in the npm package. The tests still
  run in `npm test`, because broken maintainer tooling is a broken repository.
- D2: the vault is the store, with a JSON and a Markdown note per snapshot,
  because it outlives the transcripts and is already the cross-project memory.
- D3: roles come from agent descriptions, the way the run names them. It is a
  heuristic, so the snapshot counts what it could not assign.
- D4: tokens read = input + cache read + cache write, per turn. That is the
  quantity the run's context size drives.

## Test Plan

`node:test` with a temporary `HOME` holding fixture transcripts, an OpenCode
database built with `node:sqlite` in the test, and fixture evidence in two
projects plus a worktree. Assert the totals, the marker string's absence,
`compare`'s output, `save --dry-run`, and the missing-source cases.

## Acceptance Traceability

(filled by `/flow-run`)

## Commands

```bash
npm test
```
