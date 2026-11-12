# Story 20-06 — The whole epic runs and resumes

## User Value

`ai-flow run --driver claude --epic <epic>` walks every ready agent story in
dependency order, within a budget for the whole run, and writes its state
after every transition, so `ai-flow run --resume` picks up after a crash,
a reboot or a killed terminal exactly where it stopped (bethl bilan P0: "un
état d'exécution durable et une reprise").

## Requirements

- Order: the epic's dependency tree (`backbone.js`), else story order;
  sequential (parallel chains are 24-02).
- State file `.coding-flow/runs/<runId>-state.json`: per story, phase
  (`queued`, `implementing`, `verifying`, `reviewing`, `fixing`, `done`,
  `blocked`, `needs-you`, `skipped`), attempts, session ids, evidence files,
  cost; written atomically at every transition.
- `run --resume [<runId>]` (latest unfinished by default) continues from the
  state: a phase interrupted mid-process is restarted from its beginning
  (fresh process), never assumed done.
- Caps: `run.budgetUsd.run` stops the run before starting a story it cannot
  afford (estimate: max of the story cap and the mean cost so far);
  `run.stopAfterBlocked` (default 3 consecutive blocked) stops the run.
- Independent chains continue past a blocked story; dependents are skipped.
- Chains land via 20-04's autoland as each finishes.
- Run summary printed at the end and on stop: done / blocked / needs-you /
  skipped, cost, wall time.

## Acceptance Criteria

- [ ] Given an epic with a tree `s1 → s2` and an independent `s3`, when `s1`
      is blocked, then `s2` is skipped and `s3` runs.
- [ ] Given the driver killed during `verifying`, when `run --resume` runs,
      then that story restarts at `verifying` and earlier `done` stories are
      not rerun.
- [ ] Given a run budget smaller than the next story's cap, then the run stops
      before starting it and says why.
- [ ] Given 3 consecutive blocked stories, then the run stops.
- [ ] Given the state file after any transition, then it parses and matches
      the run's events.

## Edge Cases

- A tree the parser refuses (e.g. a `┴` join, coding-flow DOGFOODING
  2026-11-10 *flow-plan / dependency tree*): the run refuses with the parser
  message and the fix ("separate independent roots with a blank line; a
  consolidating story hangs under the last of its prerequisites").

## Out of Scope

- Parallel chains (24-02).

## Security

- Budget enforcement happens before spending, never after; a missing cap
  refuses the run (20-01's preflight).
