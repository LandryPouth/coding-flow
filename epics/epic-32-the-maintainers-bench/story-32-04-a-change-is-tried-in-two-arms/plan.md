# Plan — 32-04 A change is tried in two arms

## Implementation Context

- Likely files:
  - `evals/benchmark/run.js` (a new `experiment` subcommand);
  - `evals/benchmark/arms/*.json`;
  - `docs/experiments/reliability-benchmark.md` (the protocol, updated);
  - `test/bench-experiment.test.js`.
- Search anchors:
  - `run.js setup` and `run.js accept`;
  - the 2026-10-17 and 2026-11-14 runs under `evals/benchmark/runs/`;
  - 32-01's transcript reader.
- Execution mode: STANDARD. Scout pre-step: no.
- Avoid: changing the tasks or the graders, which are fixed by the protocol.

## Decisions

- D1: the real experiment is part of done (criterion 4). A bench that has
  never run is not a bench.
- D2: three repetitions minimum for any claim, and "indicative" below that.
  Model output varies from run to run.
- D3: arms run sequentially, because of rate limits and machine load.

## Test Plan

`node:test` with a stub harness (a Node script writing a fixed transcript and
editing the workspace), two arm files, a budget crossing, and the
"indicative" wording. The real experiment runs by hand, and its numbers go in
the Result.

## Acceptance Traceability

(filled by `/flow-run`)

## Commands

```bash
npm test
```
