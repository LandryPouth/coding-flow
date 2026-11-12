# Story 21-04 — The review and the gates are priced

## User Value

`insights` says what the independent review is worth and which gates earn
their place: findings caught per reviewer origin and how many were real
(resolved `fixed`), and, for every gate, how often it fired and how often
that was useful — so a gate that only adds friction becomes visible, and the
second reviewer of 20-04 is justified by numbers, not by the bethl memory of
39-01 → 39-03.

## Requirements

- Review value, from `review.found`/`review.resolve` (18-04): per reviewer
  origin (`self`, `subagent`, `process`, `legacy-counts`) findings by severity,
  and the share resolved `fixed` vs `rejected`; findings the self-review
  missed that a process reviewer found on the same story.
- Gate precision, from `gate.fired` (18-05): per gate, fired count and outcome
  (`useful` = the story changed afterwards and passed; `overridden`;
  `noise` = no change and re-run passed); precision = useful / fired.
- Review cost: the reviewer process's `total_cost_usd` and wall time from run
  reports (20-04) next to its findings.
- Same small-sample rule as 21-01.

## Acceptance Criteria

- [ ] Given fixture events where a process reviewer found two P1 on a story
      whose self-review found none, then insights reports two findings missed
      by self-review.
- [ ] Given a gate fired five times with one useful outcome, then it prints
      "1 of 5 useful".
- [ ] Given run reports with reviewer cost, then cost per real finding is
      printed.
- [ ] Given legacy-counts reviews, then they are shown apart and never
      counted as process findings.

## Edge Cases

- A gate outcome that cannot be inferred stays `unknown`, counted apart.

## Out of Scope

- Changing any gate (epic 23 proposes; the maintainer decides).
