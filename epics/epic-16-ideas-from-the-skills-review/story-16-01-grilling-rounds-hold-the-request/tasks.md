# Story 16-01 — Tasks

- [x] Read `## Clarify First` and `### Readiness Gate` as they stand, the
      task-5 DOGFOODING row, and `git show c0bb189^:` for the old `grill-me`.
- [x] Rewrite `## Clarify First` into rounds; add the readiness rule; add one
      line to the `## Verification` checklist.
- [x] Add the `/flow-run` stop condition, removing a line elsewhere to stay
      under 500.
- [x] Update the eval cases, then run `node bin/ai-flow.js plugin sync`.
- [x] Write design-decisions entry 16; point the DOGFOODING task-5 row at
      epic 16.
- [x] Run `npm test`, `ai-flow verify`, the review, and add a CHANGELOG
      entry (Changed).

## Result

`/flow-plan`'s `## Clarify First` asks in rounds of at most 4 questions over the
decision frontier, each opening with its recommended answer, facts looked up
instead of asked, budget unchanged. `### Readiness Gate` keeps the epic
`not ready` on an unconfirmed behaviour-changing reading (`Assumption
(unconfirmed): …`), counts "go" as confirmation, and stops a headless run with
the question; `## Verification` checks it. `/flow-run`'s `## Stop Conditions`
refuses a story carrying an `Assumption (unconfirmed)` line. Design decision 16
written; DOGFOODING task-5 row points at epic 16. Skill evals: rank-1 84.4% →
84.8% (33 prompts), tiers 1 and 2 green, `plugin check` in sync.
Test: `test/clarify-rounds.test.js` (6 tests, red before the change).

### Rollback Notes

Prose, evals and docs only: `git revert` the story's commits, then
`node bin/ai-flow.js plugin sync`. No data, config or flag involved.
