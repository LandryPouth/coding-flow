# Story 26-06 — Tasks

- [x] Registry module; readers use it.
- [x] `ai-flow rules`; doctor pointer; doc test.
- [x] Inconsistency fixes (timeout constant, harness defaults, budgets, epic-size wording).
- [ ] Run `npm test`, then `ai-flow verify --story <this story>`, the review
      the mode requires, and add a CHANGELOG entry.

## Status: in-progress

## Acceptance Traceability

1. `test/rules-registry.test.js::with no config every registry key is listed with source default; a project value says project`
2. `test/rules-registry.test.js::an auto rule prints its reason and follows what it reads` — partial: the `auto` source, not `run.maxAgents` (deferred to 24-02, plan.md D2)
3. `test/rules-registry.test.js::a registry default changed without the doc fails and names the key` (and `every registry key is in docs/rules-and-limits.md with the same default`)
4. `test/rules-registry.test.js::the land lock and the command runner read the one timeout default`
5. `test/rules-registry.test.js::harness init writes coverageFloor and failOnContrarySignals with their defaults` (and `a written coverageFloor.high of auto still follows the mode`)
6. `test/rules-registry.test.js::templates/RULES.md and the flow-run skill state the same context budgets`

## Result

`ai-flow rules [<key>] [--json]` prints every registered rule's value in force
and its source: `default`, `project`, `auto: <reason>`, `fixed`; a project
value the reader refuses is shown as ignored. `bin/lib/rules-registry.js` is
the one definition of the config.json defaults, the command time limit, the
epic-size limit and 19-09's two clean rounds; harness.json's defaults stay in
`harness-config.js` (the guard's module budget) and the registry reads them.
A test checks every key's default against `docs/rules-and-limits.md`.
Inconsistencies 1, 2, 9 and 10 of that doc are fixed: one timeout default
read by the runner and land's lock; `init` writes `coverageFloor` (`high:
"auto"`) and `failOnContrarySignals`; `/flow-plan` says an epic is warned
above 7 by `doctor`; RULES.md states no budget (the test fails if it states
one the skill does not). `doctor` ends with a pointer to `ai-flow rules`.

Not done: criterion 2's `run.maxAgents` (24-02, D2). Evals unchanged: no skill
description changed (only a line of the flow-plan body).

### Rollback Notes

Revert the story's commits. No data migration: `init` only writes two more
keys into new `harness.json` files, which older versions read as before.
