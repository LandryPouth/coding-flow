# Story 16-03 — Plan

## Implementation Context

- **Execution mode**: QUICK. One measured run and one document; no skill or
  code change.
- **Likely files**: `docs/experiments/reliability-benchmark.md`, and
  `docs/DOGFOODING.md` (the task-5 row).
- **Scout pre-step**: no.
- **Areas to avoid**: `evals/benchmark/fixture/` and `tasks/`. Changing them
  would void the comparison.

## Technical Notes

- The protocol is `docs/experiments/reliability-benchmark.md` §Method:
  1. `node evals/benchmark/run.js setup <task>`;
  2. the headless arm;
  3. `run.js accept <workspace> <task>`.
- Never hand the arm the grader.

## Decisions

- **One run, coding-flow arm only** (maintainer's decision, 2026-11-10, for
  cost). The vanilla numbers from 2026-10-17 are the baseline.

## Acceptance Traceability

- 1–3 → `docs/experiments/reliability-benchmark.md`, review

## Commands

```bash
npm test
```
