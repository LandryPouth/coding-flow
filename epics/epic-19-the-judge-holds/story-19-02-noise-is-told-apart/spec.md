# Story 19-02 — Noise is told apart

## User Value

A test that fails and then passes on exactly the same tree is recognised as
noise: in a driven run the failed command is retried once, and if it passes
the verdict is `green after retry` with both attempts and the failing tests on
record; every such test enters a flaky ledger; a later failure of a known
flaky test outside the story's diff is labelled so. A red that is red twice
stays red. 23 % of bethl's red trees and 33 % of ai-learn's were this noise
(DOGFOODING 2026-11-12, verify, high).

## Requirements

- Config `validation.retry` (in `config.json`): retries of a failed command
  on the same tree; default `1` when `AI_FLOW_DRIVEN` is set, `0` otherwise.
  Only the failed command is rerun, never the whole list.
- A retry happens only if the tree token and untracked digest are unchanged
  since the first attempt (no "retry after a fix").
- Evidence: `attempts: [{ok, durationMs, failures}]` per command; verdict line
  `green after retry (<n> flaky test(s))`; coverage and other gates computed
  on the passing attempt as today.
- Ledger `.coding-flow/flaky.json`: per test (file + name): first seen, last
  seen, count, projects/stories where seen. Updated from (a) same-tree
  red-then-green within one verify (retry), (b) same-tree red-then-green
  across verifies (treeToken + untracked digest equal).
- On a red, each failing test that is in the ledger is printed `known flaky
  (seen N times)`, and flagged `outside this story's diff` when its file is
  not in the diff. The verdict is unchanged.
- Never quarantine, skip or ignore a test automatically.
- `flaky.json` follows `runs/` for tracking; it is carried on land (18-02's
  carry covers `.coding-flow/*.json` ledgers — extend it if needed).

## Acceptance Criteria

- [ ] Given a driven run where a test fails then passes on an unchanged tree,
      when verify ends, then the verdict is green, labelled `green after
      retry`, and the evidence holds both attempts and the test name.
- [ ] Given the same flaky failure in an interactive run with default config,
      then no retry happens and the run is red.
- [ ] Given a command that fails twice, then the run is red.
- [ ] Given a tree that changed between attempts, then no retry happens.
- [ ] Given a red whose failing test is in the ledger and outside the diff,
      then the output labels it known-flaky and outside the diff, and the
      verdict stays red.
- [ ] Given two verifies on the same tree, red then green, then the ledger
      records the test.

## Edge Cases

- A command with no parsable failures (19-01 empty list) retried and green:
  recorded as `command-level flake`, no test entry.
- Coverage report freshness after a retry: the report from the passing attempt
  is the one read (coding-flow DOGFOODING 2026-10-18 *verify (story 13-03)*
  suspected an `mtime < startedAt` race — keep that check per attempt).

## Out of Scope

- Quarantine (a maintainer proposal, epic 23).

## Security

A retry only re-observes the same tree; it can never turn a twice-red command
green. The ledger is advisory text; it never feeds a verdict.
