# Story 16-03 — Tasks

- [x] Confirm 16-01 and 16-02 have landed.
- [x] One benchmark run, coding-flow arm, five tasks. Write it up as a second
      dated run.
- [x] Update the DOGFOODING task-5 row; run `npm test`, `ai-flow verify`, the
      review, and add a CHANGELOG entry if anything user-visible changed.

## Result

- 16-01 and 16-02 are on this branch (`docs(16-02): done`, 16-01 `## Status: done`).
- One run, 2026-11-14, `claude-sonnet-5-5`, coding-flow arm, five tasks:
  2/5 first pass (was 3/5), $3.98 (was $3.36), 575s (was 547s), 5 re-prompts.
  Raw runs: `evals/benchmark/runs/2026-11-14/`; write-up:
  `docs/experiments/reliability-benchmark.md` §Second run; table pinned by
  `test/benchmark-results.test.js`.
- Task 5: `/flow-plan` stopped at `not ready` with an `Assumption (unconfirmed):`
  line, `/flow-run` stopped; the re-prompt's failing grader output was taken as
  the answer; no review, no `[spec]` finding. DOGFOODING row updated.
- Task 1: red reproduction recorded before the fix.
- Task 3 never went green: `/flow-run` refused all four turns on an open
  question. Tasks 2 and 3 also stopped on unconfirmed assumptions.

### Rollback Notes
