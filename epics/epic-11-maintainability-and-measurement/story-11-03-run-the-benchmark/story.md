# Story 11-03 — Run the benchmark

The comparison protocol in `docs/experiments` (Coding Flow vs the agent
alone) has never been run; its results section is pending. The external audit
calls this out, correctly: the CLI's mechanisms are tested, the claim they
serve is not.

*(QUICK — execution of an existing protocol and a write-up; no product code.)*

## Acceptance Criteria

- [ ] The protocol is run as written (or its deviations are listed first),
      on at least the task count it specifies, for both arms.
- [ ] Recorded per task: first-try success, files forgotten, time, tokens,
      escaped defects found afterwards.
- [ ] Results written into the experiment document, including the arm that
      lost and anything that contradicts the hypothesis.
- [ ] One row in `docs/DOGFOODING.md` if the result changes what to build
      next.

## Status: planned
