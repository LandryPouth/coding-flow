# Story 26-06 — Tasks

- [x] Registry module; readers use it.
- [x] `ai-flow rules`; doctor pointer; doc test.
- [x] Inconsistency fixes (timeout constant, harness defaults, budgets, epic-size wording).
- [x] Run `npm test`, then `ai-flow verify --story <this story>`, the review
      the mode requires, and add a CHANGELOG entry.

## Status: done

## Acceptance Traceability

1. `test/rules-registry.test.js::with no config every registry key is listed with source default; a project value says project` (and, review round 1, `init then rules: the fresh coverageFloor.high of auto is an auto rule, not an ignored value`, plus one malformed-value test per reader, and round 2's `an unreadable harness.json is named, and each rule shows what its consumer does without it` and its config.json twin; round 3's `primaryLocked and unreadable agree with the guard for every shape of harness.json`, `config.json is unreadable only when readConfig cannot parse it`, `from a linked worktree, primaryLocked follows the primary checkout as the guard does`; round 4's `a base commit's stricter contrary policy and risk lists are shown with the tree's`, `mode fast is shown as treated as standard`; new series round 1's `policyGlobs says what readPolicyChanged and --claim refactor add to it`, `blockedPaths and validation.commands say what the guard and verify add`, round 2's `validation.commands names the freshCommands a fresh run uses instead`)
2. `test/rules-registry.test.js::an auto rule prints its reason and follows what it reads` — partial: the `auto` source, not `run.maxAgents` (deferred to 24-02, plan.md D2)
3. `test/rules-registry.test.js::a registry default changed without the doc fails and names the key` (and `every registry key is in docs/rules-and-limits.md with the same default`)
4. `test/rules-registry.test.js::the land lock and the command runner read the one timeout default`
5. moved to story 26-08 (plan.md, Split): `test/rules-registry.test.js::init writes coverageFloor and failOnContrarySignals with the spec values` is marked `todo` for it
6. `test/rules-registry.test.js::templates/RULES.md and the flow-run skill state the same context budgets`

## Result

`ai-flow rules [<key>] [--json]` prints every registered rule's value in force
and its source: `default`, `project`, `auto: <reason>`, `fixed`; a project
value the reader refuses is shown as ignored — every value is read through the
consumer's own normalisation (plan.md D7), and an unreadable file is named
with what each consumer does without it (D8); every value comes from the
consumer's own resolver, which the consumer itself calls (D9), and what the
diff base still applies is shown with the tree's value (D10). `bin/lib/rules-registry.js` is
the one definition of the config.json defaults, the command time limit, the
epic-size limit and 19-09's two clean rounds; harness.json's defaults stay in
`harness-config.js` (the guard's module budget) and the registry reads them.
A test checks every key's default against `docs/rules-and-limits.md`.
Inconsistencies 1, 2 and 9 of that doc are fixed: one timeout default
read by the runner and land's lock; `/flow-plan` says an epic is warned
above 7 by `doctor`; RULES.md states no budget (the test fails if it states
one the skill does not). `doctor` ends with a pointer to `ai-flow rules`.

Not done: criterion 2's `run.maxAgents` (24-02, D2; 24-02's spec now has the
criterion); criterion 5 and inconsistency 10, `init` writing `coverageFloor`
and `failOnContrarySignals`, moved to story 26-08 at the review cap (plan.md,
Split). Evals unchanged: no skill
description changed (only a line of the flow-plan body).

### Rollback Notes

Revert the story's commits. No data migration: `init` writes what it wrote
before, and `rules` only reads.
