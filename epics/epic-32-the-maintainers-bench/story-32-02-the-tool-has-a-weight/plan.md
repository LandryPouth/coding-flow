# Plan — 32-02 The tool has a weight

## Implementation Context

- Likely files:
  - `evals/bench/weight.js`, `evals/bench/budgets.json`;
  - `.github/workflows/*.yml` (one step on the Ubuntu job);
  - `test/bench-weight.test.js`.
- Search anchors:
  - the guard's `decide()` entry;
  - the 29-03/29-04 latency measurements in their `plan.md` (in-process
    1.2 → 2 ms, cold CLI 193 → 209 ms);
  - what `init` writes (`templates/`).
- Execution mode: STANDARD. Scout pre-step: no.
- Avoid: `bin/` behaviour. It is measured, never changed here.

## Decisions

- D1: tokens are estimated as characters ÷ 4 to stay dependency-free, and
  labelled as an estimate. The trend matters, not the absolute value.
- D2: budgets apply to totals, so a new skill can be added without editing
  per-file budgets, but the sum stays bounded.
- D3: latency does not gate under load. A false red on a loaded CI runner
  would teach people to ignore the check.

## Test Plan

`node:test`: the command on this repository, a lowered budget in a temporary
copy of `budgets.json`, a load stub, and the shape of the JSON output.

## Acceptance Traceability

(filled by `/flow-run`)

## Commands

```bash
npm test
```
