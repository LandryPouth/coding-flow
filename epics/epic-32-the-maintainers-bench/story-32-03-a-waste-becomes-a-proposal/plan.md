# Plan — 32-03 A waste becomes a proposal

## Implementation Context

- Likely files:
  - `evals/bench/detect.js`, `evals/bench/detectors/*.js` (one file each,
    pure: snapshot in, findings out);
  - `test/bench-detect.test.js`.
- Search anchors:
  - epic 23's proposal format (`epics/epic-23-…/index.md`, Decisions);
  - the vault's `_templates/proposal.md`;
  - the tree token and policy fingerprint in the verify evidence.
- Execution mode: STANDARD. Scout pre-step: no.
- Avoid: `bin/`. Nothing ships.

## Decisions

- D1: it writes epic 23's format into the vault's `coding-flow/proposals/`, so
  there is one proposal store, not a second one.
- D2: the cap of 3 per pass and the no-repeat rule mirror epic 28's ideas
  ledger. A wall of proposals is not read.
- D3: savings are estimates (tokens or hours), labelled as such, computed from
  the snapshot's own numbers.

## Test Plan

Pure detector tests on fixture snapshots, plus one end-to-end test that writes
into a temporary vault directory: ranking, deduplication, refused proposals,
`--dry-run`.

## Acceptance Traceability

(filled by `/flow-run`)

## Commands

```bash
npm test
```
