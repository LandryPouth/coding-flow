# Story 26-06 — Plan

## Implementation Context

- **Execution mode**: STANDARD.
- **Likely files**: `bin/lib/rules-registry.js` (new), `bin/lib/config.js`,
  `bin/lib/harness-config.js`, `bin/lib/validation-run.js`,
  `bin/lib/worktree.js`, `bin/lib/doctor.js`, `bin/ai-flow.js`,
  `templates/RULES.md`, `skills/flow-run/SKILL.md`,
  `skills/flow-plan/SKILL.md`, `docs/rules-and-limits.md`, tests
  `test/rules-registry.test.js` (new).
- **Shared identifiers**: `DEFAULT_COMMAND_TIMEOUT_MS`,
  `PER_COMMAND_TIMEOUT_MS`, `coverageFloor`, `failOnContrarySignals`.
- **Search anchors**: `defaultHarnessConfig`, `defaultConfig`, `_MS =`.
- **Scout pre-step**: no.
- **Areas to avoid**: changing values (only where they are defined).

## Decisions

- **The doc is checked, not generated**: prose and sources stay human;
  only the defaults are compared.
- **D1 — One definition per default; harness.json's stay where the guard
  loads them (2026-11-24).** `bin/lib/rules-registry.js` defines the
  config.json defaults, the command time limit and the epic-size limit;
  `config.js`, `validation-run.js`, `worktree.js` and `doctor.js` read them
  there. The harness.json defaults stay defined in `harness-config.js`: the
  guard loads that file before every tool call, its module graph is a budget of
  6 (`test/guard.test.js`), and requiring the registry from it made 7 — raising
  the budget would weaken that test. The registry reads them from
  `harness-config.js` on demand (`defaultFrom`), so each default still has one
  definition, and `rules` and the doc test see them. The registry is a leaf at
  load time, classified core, and listed in this repo's `highRiskPaths` (it
  sets proof parameters such as the command time limit;
  `test/security-core-risk.test.js`).
- **D2 — `run.maxAgents` is not registered (criterion 2 left `[~]`).** The
  criterion's example key belongs to 24-02 and the user global config, neither
  shipped; the spec's own edge case keeps planned keys out of the registry, and
  printing a value no code applies would be a false rule. The `auto` scope
  ships with a real rule instead: `coverageFloor.high` prints
  `auto: mode standard → evidence` (or `strict → verified`). `run.maxAgents`
  joins the registry, with its WSL reason, in 24-02.
- **D3 — `init` writes `coverageFloor` and `failOnContrarySignals`, the
  readers' defaults do not grow.** `defaultHarnessConfig()` is merged into the
  config hashed by the policy fingerprint; adding keys there would make every
  existing proof stale on upgrade. A new `initialHarnessConfig()` is what
  `init` / `harness init` write. A written `coverageFloor.high` of `"evidence"`
  would silently stop following `mode: strict`, so `init` writes `"auto"`,
  which `resolveCoverageFloor` already read as the mode default.
- **D4 — A fourth scope, `fixed`.** Limits in the code that no file sets
  (`epic.maxStories`, and the rules 19-09 and 29-03 add) are printed with
  source `fixed`, so `rules` answers for them too. `user` stays reserved for
  the user global config (19-03, 24-02).
- **D5 — Context budgets live in the skill only.** `templates/RULES.md` says
  budgets live in `/flow-run` ("never write a rule in both places"), so the fix
  is not to copy them: the registry holds the skill's three budget phrases, the
  test checks the skill states each, and fails if `RULES.md` ever states a
  number the skill does not.
- **D6 — How the doc writes a default.** A scalar in backticks plus its unit
  (`` `600000` ms ``, `` `80` % ``), an empty list `` `[]` ``, a list by its
  count. Rows that grouped several keys were split, one key per row, so the
  test can find each.

## Test Plan

Registry vs doc; effective-value sources; harness defaults written;
budget text compared between template and skill.

## Acceptance Traceability

- 1–6 → `test/rules-registry.test.js`

## Commands

```bash
npm test
```
