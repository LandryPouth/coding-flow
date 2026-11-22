# Story 18-04 — Review findings are captured before fixes

## User Value

A review is recorded in two steps: what it found (each finding, as found, with
the reviewer's origin), then what happened to each finding. The record finally
says what the independent review is worth: today 184 bethl reviews claim
self-review finds more (0.28 p0+p1 per review) than the independent one
(0.17), because counts are captured after the fixes (DOGFOODING 2026-11-12,
review capture).

## Requirements

- `ai-flow review found --story <dir> --reviewer self|subagent|process
  --severity p0|p1|p2|p3 --category <slug> --file <path[:line]> --summary
  "<one line>"` appends one finding with an id (`F1`, `F2`… per story and
  review round) to the round's evidence and a `review.found` event.
  `--from <file.json>` accepts a list (what a reviewer process emits).
- `ai-flow review resolve --story <dir> --id F2 --outcome fixed|documented|
  rejected --note "<reason>"` records the outcome and a `review.resolved`
  event.
- `ai-flow review capture --verdict` closes the round: counts are derived
  from the findings (found counts and open counts both kept); `--p0..--p3`
  stay accepted, and the record says `origin: legacy-counts`.
- A round with an unresolved P0/P1 cannot be captured `pass` (the existing
  verdict rules apply on open findings).
- Reviewer origin is recorded: `self`, `subagent`, `process` (epic 20's
  second process). In STRICT, a `pass` whose only reviewer is `self` is shown
  as `review: self (not independent)` by `status`; 20-04 makes the driver
  require a non-self reviewer.
- A review does not go stale on a base merge that touches none of the files
  the review covered (bethl bilan P0): freshness compares the reviewed files'
  content, not the whole tree.

## Acceptance Criteria

- [ ] Given two findings recorded with `review found`, when one is resolved
      `fixed` and the round is captured `pass`, then the evidence keeps found
      counts p1=2 and open counts p1=0, with both ids and outcomes.
- [ ] Given an open P1, when `review capture --verdict pass` runs, then it is
      refused and names the open id.
- [ ] Given `review capture --p1 2` with no findings, when it runs, then the
      record is written with `origin: legacy-counts`.
- [ ] Given a STRICT story reviewed only by `self`, when `status` runs, then
      the review column says it is not independent.
- [ ] Given a captured review, when a base merge changes only files outside
      the reviewed set, then the review stays fresh; when it changes a
      reviewed file, it goes stale.
- [ ] Given `review found` and `review resolve`, then `review.found` and
      `review.resolved` events are in the journal.

## Edge Cases

- A finding without a file (architecture-level): `--file` optional, category
  required.
- Several review rounds per story (fix loop): ids restart per round, rounds
  are numbered.

## Out of Scope

- The metrics over findings (21-04); the reviewer process itself (20-04).
