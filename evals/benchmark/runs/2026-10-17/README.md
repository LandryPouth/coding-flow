# Raw runs, 2026-10-17

The ten sessions behind the results in
[`docs/experiments/reliability-benchmark.md`](../../../../docs/experiments/reliability-benchmark.md).
`A` = vanilla, `B` = coding-flow. One directory per task and arm:

- `run-*.json` — `claude -p --output-format json` output (`run-plan.json` is arm B's
  `/flow-plan` session, `run-0` the first `/flow-run`, `run-1` the re-prompt);
- `accept-*.txt` — `run.js accept` output after each run; `exit-*` its exit code;
- `diffstat.txt` — what the arm changed, as recorded at the time;
- `final.patch` — the final `src/` and `spec/` diff against the fixture commit,
  exported from the surviving workspaces (the grader's `accept.spec.js` excluded).

`final.patch` was exported after the fact; everything else is as the runs wrote it.

The results table is `node evals/benchmark/run.js summarize` run on this directory.
