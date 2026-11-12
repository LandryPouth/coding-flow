# Story 23-05 — The watcher runs after every epic

When a driven epic ends (20-07's report written), the driver launches
`/flow-improve` in a fresh `claude -p` process, within the run budget, so
proposals appear without anyone remembering to ask; `ai-flow improve` runs it
on demand.

*(QUICK — one hook at the end of the epic run and one command.)*

## Acceptance Criteria

- [ ] Given a driven epic that ends, then one `claude -p
      "/coding-flow:flow-improve"` process starts (read-only tools,
      `--max-budget-usd` from `run.budgetUsd.watcher`, default 1) after the
      report, and its cost is in the run summary.
- [ ] Given `run.watcher: false` in `config.json`, then it is skipped.
- [ ] Given a run budget already spent, then the watcher is skipped and the
      report says so.
- [ ] Given `ai-flow improve`, then the same process runs on demand
      (listed in `help --all`).
- [ ] Given a watcher failure, then the epic run still ends successfully.
- [ ] Given the change is complete, when `npm test` runs, then it is green and
      `CHANGELOG.md` has an entry for the watcher hook.
