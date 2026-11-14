# Raw runs, 2026-11-14

The second run of the reliability benchmark: the coding-flow arm only (`B`),
after the 2026-11-10 prose pass and stories 16-01 and 16-02. The vanilla arm
was not re-run; its 2026-10-17 numbers are the baseline. Results and
deviations are in
[`docs/experiments/reliability-benchmark.md`](../../../../docs/experiments/reliability-benchmark.md).

Same layout as [`2026-10-17`](../2026-10-17/README.md):

- `run-plan.json` — the `/coding-flow:flow-plan` session, `run-0.json` the
  `/coding-flow:flow-run` session, `run-<k>.json` the k-th re-prompt
  (`--continue`, with the failing acceptance output);
- `accept-*.txt` and `exit-*` — `run.js accept` after each run;
- `init.log` — `ai-flow init` in the workspace;
- `diffstat.txt` and `final.patch` — the arm's changes against the fixture
  commit (staged in the workspace first, so new files count; the grader's
  `accept.spec.js` excluded). Written by the run itself, not after the fact.

The results table is `node evals/benchmark/run.js summarize` run on this
directory.
