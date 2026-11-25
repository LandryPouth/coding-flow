# Story 32-04 — A change is tried in two arms

## User Value

Before a change to how runs are driven is trusted, it is played on the same
tasks in two arms, the current way and the changed way. The hidden graders
judge quality, and the ledger counts tokens and time. Examples of such a
change: a fresh implementer for each round, `review pack`, or a lighter skill.
A gain that was not measured is not claimed.

## Requirements

- **`node evals/benchmark/run.js experiment <name> --arms <a,b> [--tasks <ids>] [--budget <tokens>]`**
  plays each task of `evals/benchmark/tasks/` in each arm, on a throwaway
  workspace (the existing `setup`).
  - An arm is a file `evals/benchmark/arms/<name>.json` holding:
    - the harness command (non-interactive Claude Code, or OpenCode);
    - the prompt preamble;
    - the Coding Flow install mode;
    - the fix-round policy.
  - The grader (`accept.spec.js`) is copied in after the arm finishes, as
    today.
- **Per arm and task**, it records:
  - the pass or fail of the grader;
  - tokens: the session's own transcript read by 32-01's reader, or the
    harness's JSON usage output;
  - wall time and number of turns;
  - the review findings, when the arm reviews.

  The results go to `evals/benchmark/runs/<date>-<name>/` as JSON.
- **The token budget is enforced.** Past it, the remaining runs are skipped,
  and the report says how many and which.
- **The report** compares the arms task by task: graders passed, tokens
  (median and range), time. With fewer than 3 repetitions per task and arm,
  it says "indicative" and draws no conclusion.
- **The result goes to the vault** as a note in
  `workflows/epic-run/bench/` (aggregates only).
- **First experiment:** `resumed-implementer` vs `fresh-implementer`, the
  epic-run rule set on 2026-11-25, on tasks 01, 04 and 05.

## Acceptance Criteria

- [ ] Given two arm files and a stub harness that writes a fixed transcript,
      when `experiment` runs, then each task runs once per arm, the grader is
      applied after the run, and the result JSON holds pass/fail, tokens, time
      and turns per arm and task.
- [ ] Given a budget smaller than the stub's cost of two runs, then the third
      run is skipped, and the report lists what was skipped.
- [ ] Given one repetition, then the report says "indicative" and no arm is
      called better.
- [ ] The first real experiment (`resumed-implementer` vs `fresh-implementer`,
      tasks 01, 04 and 05, 3 repetitions) has run within its budget, and its
      vault note exists. The numbers are recorded in the Result.

## Edge Cases

- A harness that fails to start: the run is recorded as `error`, not `fail`.
  An error is the tool's problem; a fail is the arm's.
- Free OpenCode models are rate-limited: arms run one after the other, never
  in parallel. The project memory says at most 3 sessions, run sequentially.

## Out of Scope

- New benchmark tasks. That comes later, from real stories of the run.
