# Story 11-03 — Run the benchmark

The comparison protocol in `docs/experiments` (Coding Flow vs the agent
alone) has never been run; its results section is pending. The external audit
calls this out, correctly: the CLI's mechanisms are tested, the claim they
serve is not.

*(QUICK — execution of an existing protocol and a write-up; no product code.)*

## Acceptance Criteria

- [x] The protocol is run as written (or its deviations are listed first),
      on at least the task count it specifies, for both arms.
- [x] Recorded per task: first-try success, files forgotten, time, tokens,
      escaped defects found afterwards. *(Files forgotten and escaped defects
      graded by hand after the runs, from the committed diffs — see the
      experiment document.)*
- [x] Results written into the experiment document, including the arm that
      lost and anything that contradicts the hypothesis.
- [x] One row in `docs/DOGFOODING.md` if the result changes what to build
      next.

## Result

Ran all five tasks in both arms (10 headless sessions, `claude-sonnet-5-5`, N=1).
Coding Flow 3/5 first-pass against 4/5 for the agent alone, ~3.5× the cost. The
hypothesis is not supported; deviations and the losing arm are listed in
`docs/experiments/reliability-benchmark.md`. Raw runs committed in
`evals/benchmark/runs/2026-10-17/`. DOGFOODING row added.

## Test Exemption

Documentation and measurement only; no product code or test file changes.

## Status: in-review
