# Story 23-04 — An accepted proposal is an experiment

## User Value

An accepted proposal is not merged and forgotten: it runs behind a flag,
is compared with and without on the benchmark, then measured in production
runs for the window its `success` names, and ends `confirmed` or `reverted` —
the revert recorded so the watcher sees its own misses.

## Requirements

- `ai-flow experiment start <proposal>`: status `measuring`, creates the
  experiment note (vault `coding-flow/experiments/`, else
  `.coding-flow/experiments/`) with the flag name (`experiments.<id>` in
  `config.json`), baseline metric values from `insights`.
- Benchmark: `evals/benchmark/run.js --flag <id>` runs with and without; the
  result is attached to the note (cost, yield, noise).
- Production window: after `success.minRuns` runs with the flag on,
  `ai-flow experiment check <id>` compares the metric to the baseline and
  prints `confirmed`, `reverted` or `inconclusive` (more runs needed); the
  maintainer records the verdict with `experiment end <id> --verdict
  confirmed|reverted --why`.
- `reverted` proposals remain visible to `/flow-improve` input (23-01) as
  `evidence.misses`.

## Acceptance Criteria

- [ ] Given an accepted proposal, when `experiment start` runs, then the note
      has the baseline and the flag.
- [ ] Given fewer runs than `minRuns`, then `check` says inconclusive.
- [ ] Given enough runs moving the metric past the target, then `check`
      suggests confirmed.
- [ ] Given `experiment end --verdict reverted`, then the proposal status is
      `reverted` and the next watcher input includes it as a miss.
- [ ] Given `evals/benchmark/run.js --flag`, then both arms run and the note
      receives their numbers.

## Edge Cases

- Two experiments on the same metric overlapping: `check` warns the result is
  confounded.

## Out of Scope

- Statistical tests beyond counts and the target comparison.
