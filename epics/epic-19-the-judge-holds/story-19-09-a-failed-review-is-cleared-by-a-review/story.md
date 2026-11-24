# Story 19-09 — A failed review is cleared by a review

> STANDARD · added 2026-11-24 at the maintainer's request · ahead of 20-04

## Why

A review can PASS, and a second, independent review of the same story then
FAIL. After a FAIL, the fixes are made and a green `verify` is easy to take as
the end — but verify proves the tests, not that the findings are closed, and
the fixer judging their own fix is the weakest check there is. The maintainer
wants a FAIL cleared only by a new review round. The epic-run skill already
does this (step 4b); Coding Flow itself does not: today a `pass` can be
captured right after a `fail` with nothing in between.

20-04 will run rounds automatically (fresh reviewer each round, two clean
rounds for STRICT, a cap). This story is the small guard that holds until
then, and the field 20-04 builds on.

## What changes

- `ai-flow review capture --verdict pass` on a story whose latest captured
  review is `fail` is refused unless it declares a new round:
  `--round <n>` with `n` = the failed review's round + 1 (a review captured
  without `--round` counts as round 1). The message says why: "a failed review
  is cleared by a new review of the whole diff, not by verify alone", and
  gives the command.
- The pass records `round` and `after` (the failed review's evidence file),
  so `status --json` and the PR evidence show the history: "pass, round 2,
  after a fail".
- A STRICT story (risk from the diff) needs two consecutive passing rounds
  after a fail before its review counts as clean in `status`; the first is
  shown as "pass — one more round required (STRICT)".
- `--accept "<reason>"` still lets the user accept the risk, recorded.
- `flow-review` and `flow-run` skills: one paragraph — after a FAIL, fix every
  finding, then run a NEW review (fresh reviewer, whole diff, blind first,
  then the previous list); never conclude on verify alone. Same wording as
  20-04's spec so the two agree.

## Acceptance Criteria

- [ ] Given a story whose latest review is `fail`, when `review capture
      --verdict pass` runs without `--round`, then it exits non-zero, writes
      no evidence, and the message names the rule and the command.
- [ ] Given the same story, `--verdict pass --round 2` is captured, records
      `round: 2` and `after: <fail evidence>`, and `status --json` shows it.
- [ ] Given `--round 3` right after a round-1 fail (a skipped number), then
      it is refused.
- [ ] Given a STRICT story, a first passing round after a fail leaves its
      review not clean in `status`; a second consecutive pass makes it clean;
      a fail in between restarts the count.
- [ ] Given a story with no failed review, `review capture --verdict pass`
      behaves exactly as before (no new flag required).
- [ ] `--accept "<reason>"` captures a pass after a fail without a round, and
      the reason is stored.
- [ ] The two skills carry the paragraph; `plugin sync` run, `plugin check`
      green, evals updated in the same commit.

## Out of scope

- Running the reviewers, counting P1 per round, the round cap and
  `review-not-converging`: 20-04.
- Telling whether the reviewer was really new: the tool records what it is
  told; the skills carry the rule.

## Tasks

- [ ] Refusal, `--round`, `after`, STRICT two-round count, `--accept`.
- [ ] `status --json` and PR evidence show round and history.
- [ ] Skills paragraph, `plugin sync`, evals.
- [ ] Run `npm test`, then `ai-flow verify --story <this story>`, the review
      the mode requires, and add a CHANGELOG entry (Behaviour changes).

## Status: planned

## Result

### Rollback Notes
