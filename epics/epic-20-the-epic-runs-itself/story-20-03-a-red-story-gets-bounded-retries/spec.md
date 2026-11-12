# Story 20-03 — A red story gets bounded retries

## User Value

When the CLI's verify is red after the agent's attempt, the driver gives the
story a bounded number of fresh attempts, each told exactly which tests failed
and required to say why before changing anything; a process that hangs is
killed and counted. Then the story is `blocked` with what was tried, and its
dependents are skipped. The research is explicit: more retries raise cheating
(33 → 38 %), so attempts are few and reflective.

## Requirements

- `run.attempts` (default 2) implementation attempts per story.
- Each retry is a new `claude -p` process (fresh context) whose prompt adds:
  the failing tests and stop causes from 19-01, the previous attempt's
  `## Result`, and the instruction to write a `### Attempt N` paragraph
  ("why it failed, what changes") in `## Result` before editing.
- Wall-clock limit per process `run.processTimeoutMin` (default 45): on expiry
  the process group is killed, `run.agent.end` records `timeout`, the attempt
  counts.
- No progress detection: no file change and no tool call output for
  `run.stallMin` (default 10) → treated as a timeout.
- A verify that ends as a tool error (machine busy, 19-03) does not consume an
  attempt; the driver waits and re-verifies.
- After the last red attempt: the story's `tasks.md` gets `## Status:
  blocked` (written by the CLI) with the failing tests; dependents are
  `skipped` in the run report.

## Acceptance Criteria

- [ ] Given a stub agent that fails the first attempt and fixes on the second,
      when the run executes, then verify is green after attempt 2 and both
      attempts are in the run report.
- [ ] Given the retry prompt, then it contains the failing test names from
      the previous verify.
- [ ] Given a stub that hangs, then it is killed at the limit and the attempt
      counts.
- [ ] Given two red attempts, then the story is `blocked` by the CLI with the
      failing tests and no third attempt starts.
- [ ] Given a `machine busy` tool error, then no attempt is consumed.

## Edge Cases

- A retry that edits a protected test is denied by 19-07; the attempt ends red
  or `Needs you`, never green by test edits.

## Out of Scope

- The review fix pass (20-04).
