# Story 21-01 — Insights from the runs already recorded

## User Value

`ai-flow insights` prints, for this project, the numbers that say whether the
factory works — from the journal (epic 18) and, for history, from the legacy
`.coding-flow/runs/*.json` files — so the baseline computed by hand on
2026-11-12 in `docs/plans/autonomous-factory.md` (bethl: 23–33 % of verifies
red for noise, ~40 % of reds outside the diff) comes out of the tool and can
be watched as epic 19 lands.

## Requirements

- New `bin/lib/insights.js`: pure functions from events (plus backfilled
  legacy runs) to metrics; `ai-flow insights [--since <date>] [--json]` prints
  them, listed in `help --all` (machinery, front door unchanged).
- Backfill: a legacy `*-verify.json` becomes synthetic `verify.end` events
  marked `origin: legacy`; never written back to the journal.
- Metrics (each with its definition printed under `--explain` and present in
  the JSON):
  - **first-pass yield**: stories whose first verify after implementation is
    green;
  - **verifies per done story**, and **time in verify** (sum of durations);
  - **noise**: reds whose failing tests are outside the diff, retried green
    (19-02), or known flaky — split by cause; for legacy runs without test
    names, classed `unknown`;
  - **tool errors** (killed, oom-suspected, queue exhausted);
  - **stories done without a CLI verify** (claimed done, no evidence).
- Below 20 observations a metric prints counts ("3 of 11"), never a bare
  percentage.
- Deterministic: same files, same output; no model, no network.

## Acceptance Criteria

- [ ] Given a fixture of legacy `runs/*.json` reproducing the bethl sample,
      when `insights --json` runs, then the noise and yield values match the
      fixture's expected numbers.
- [ ] Given a journal and legacy runs covering the same verify, then it is
      counted once (journal wins).
- [ ] Given 11 observations, then the metric prints "n of 11", not a percent.
- [ ] Given `insights --explain`, then every metric prints its definition.
- [ ] Given `help` and `help --all`, then `insights` appears only in
      `--all`.

## Edge Cases

- Runs from before story 19-01 have no test names: noise `unknown`, counted
  separately, never guessed.
- Corrupt event lines are skipped and counted (18-01 reader contract).

## Out of Scope

- Vault export (21-02), cross-project (21-03), review and gate pricing
  (21-04).
