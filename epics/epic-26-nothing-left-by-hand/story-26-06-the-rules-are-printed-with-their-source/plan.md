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
  joins the registry, with its WSL reason, in 24-02: its spec carries that criterion (added in this story's diff).
- **D3 — *Superseded by the Split below (moved to 26-08).* `init` writes `coverageFloor` and `failOnContrarySignals`, the
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
- **D7 — `rules` reads each value through its consumer (review round 1).**
  The raw merged file passes a malformed value through untouched, while the
  consumer refuses it (`mode === "strict"`, `enforce === true`,
  `Number.isFinite(timeoutMs)`), so printing it would claim a rule that is not
  applied. `rules.js` holds one entry per key whose reader is not
  `readConfig`/`readHarnessConfig`: it calls the consumer's own function
  (`complexity.functionSizeSettings`, `guard.destructivePolicy`,
  `coverage.defaultCoverageFloor` for the auto reason) or mirrors its one-line
  test. `mode` accepts the three modes `harness init --mode` accepts. The
  `"auto"` `init` writes for `coverageFloor.high` reads as no key.
  `harness init` on an existing file merges `defaultHarnessConfig()`, not the
  `init` keys, so `--force` keeps the policy fingerprint.
- **D8 — An unreadable file is its own state (review round 2).** A file that
  exists but does not parse is not a missing one: `rules` names it on the
  first line (and in `--json` `unreadable`), and each of its rules shows what
  the consumer does in that state with source `fixed: <file> unreadable` —
  the defaults for readConfig/readHarnessConfig, and the guard's kept primary
  lock. *(Removed at the Split: `init`/`harness init` writing the plain
  defaults when verify proofs exist.)* `ensureConfig`
  takes its defaults from the registry; `next` reads the clean-round count
  from it.
- **D9 — `rules` calls each consumer's own resolver (review round 3).**
  Three rounds found `rules` drifting from a consumer whose logic it copied,
  so no copy is left: where the logic was inline, it was extracted into an
  exported function that the consumer itself now calls, and `rules` calls the
  same one. Unreadable is what the consumer reports (a parsed `null`, array or
  string is readable; the readers apply their defaults to it).

  | Key | Consumer function `rules` calls |
  |-----|---------------------------------|
  | config.json keys (`storage` … `validation.timeoutMs`) | `config.js` `readConfigReport` (= `readConfig`, plus `unreadable`) |
  | `mode` | `harness-config.js` `harnessMode` (evidence.js, coverage-gate.js, guard.js `loadPolicy`) |
  | `coverageFloor.high/medium/low` | `coverage.js` `resolveCoverageFloor`; the auto reason `defaultCoverageFloor` |
  | `failOnContrarySignals` | `coverage-gate.js` `failsOnContrarySignals` (`contraryPolicy`) |
  | `functionSize.max/enforce` | `complexity.js` `functionSizeSettings` |
  | `redAtBase.command/timeoutMs` | `red-at-base.js` `redAtBaseSettings` (`runRedAtBase`) |
  | `destructiveCommands`, `allowDestructive`, `worktrees.primaryLocked`; harness.json unreadable | `guard.js` `effectiveDestructivePolicy` (`loadPolicy` + `primaryLock`, which `settle` calls) |
  | every other harness.json key | `harness-config.js` `readHarnessConfig` |
  | read at the diff base: `mode`, `failOnContrarySignals` | `coverage-gate.js` `contraryPolicyInForce` (`contraryEnforced`), base from `readBaseConfig` |
  | read at the diff base: `highRiskPaths`, `testGlobs`, `ignoredPaths` | `coverage-gate.js` `baseRiskConfig` and `BASE_RISK_KEYS` (`strictestRisk`) |
  | read at the diff base: `policyGlobs` | `policy-drift.js` `policyGlobsAtBase` (`readPolicyChanged`), base from `readBaseHarness` |
  | default of `coverageFloor.medium/low`, `failOnContrarySignals` | `coverage.js` `defaultCoverageFloor`, `coverage-gate.js` `failsOnContrarySignals({})` |
  | `policyGlobs` note | `policy-drift.js` `OWN_POLICY_FILES`; `claim.js` `claimPolicyGlobs` (`scopeFailures`, `--claim refactor`) |
  | `blockedPaths` note | `guard.js` `shellBlockedPaths` (`shellWriteDenial`) |
  | `validation.commands` note | `validation-run.js` `resolveCheckCommands` (the plan.md / package.json fallback) |

  Audit of every other reader of a printed key (new series, round 1), by
  grep over `bin/lib/`: each reads the value `readConfig` /
  `readHarnessConfig` / `loadPolicy` resolved and applies it as printed, or
  re-applies the same fallback —
  `minPatchCoverage` (`coverage-gate.js`, `claim.js`: finite else 80, the
  reader's default), `highRiskPaths` (`risk.js`, `coverage-gate.js`: array
  else the defaults), `testGlobs` (`claim.js`, `mutation.js`,
  `complexity.js`), `nonBehaviorGlobs` (`complexity.js`, `recover.js`),
  `ignoredPaths` (`diff-scope.js`), `highRiskTerms` (`risk.js`),
  `sensitiveGlobs` (`recover.js`, `security-policy.js`), `requiredChecks`
  (`evidence.js` adds three checks for a high-risk story — per story, not a
  project rule), `blockedPaths` (`guard.js` `loadPolicy`, `codex-settings.js`
  through it), `storage` (`storage/index.js`, `archive.js`), `branchPerEpic`
  (`policy.js`), `autoMergeEpic` (`ship.js`; `--auto-merge` overrides it per
  run), `skills`/`install`/`target` (`doctor.js`, `report.js`),
  `validation.*` (`validation-run.js`). None applies another value; the three
  that add to it are noted above.

- **D10 — What the base holds is part of the value in force (review round
  4).** The gates judge a diff by the stricter of its base and its tree
  (`docs/rules-and-limits.md`, Part 1 and the contrary-signals row), so a
  tree that drops `failOnContrarySignals` or steps down from strict does not
  turn them off for its own diff. `rules` prints the tree's value with a
  note when the base still applies: `project (base's true still applies)`
  (the value printed is then `true`), `(base's strict still applies to
  contrary signals)`, `(the base's N globs also score risk)`, `(policy
  changes are found with the base's N globs)`. `mode: fast` is shown
  `project (treated as standard)`: every consumer compares with `"strict"`
  only. `rules` reads the project once per command.

- **D11 — What a consumer always adds is a note, not a source (new series,
  round 1).** `rules --json` carries `note`; the table prints it after the
  source (`; also: …`), the detail view as `also:`. The source still says
  where the key's own value came from.

**Out of scope, seen in review:** `doctor`'s `epic_too_large` warning never
shows (pre-existing, not this story's diff).

**New review series** (after the split): round 1 FAIL, 1 P1 (`policyGlobs`
under `--claim refactor`, D9 audit, D11).

## Split (review cap, 2026-11-24)

Review history: 4 rounds, each FAIL; P1 per round 2 / 1 / 1 / 2.

1. Round 1 — `init`'s `"auto"` shown as ignored; malformed values printed as
   applied (D7).
2. Round 2 — an unparsable `harness.json` silently read as `{}` (D8).
3. Round 3 — `null` mistaken for unreadable; the linked worktree's primary
   lock (D9).
4. Round 4 — base/tree combination not shown (D10); proofs of a project in
   a repository subdirectory missed by the cross-checkout search.

Run decision at the cap: split. The change making `init` / `harness init`
write `coverageFloor` and `failOnContrarySignals` (`initialHarnessConfig`,
D3, the proof search) is taken out: `init` writes exactly what it wrote
before (`defaultHarnessConfig()`), so no fingerprint can move, and round 4's
second P1 disappears with it. It is story
[26-08](../story-26-08-init-shows-the-rules-it-applies/story.md), with the
fingerprint trap and its four shapes; criterion 5 moved there, and its two
tests are marked `todo` for 26-08. `rules`, the registry, the consumer
resolvers and the unreadable handling stay here. A new review series starts
at round 1.

## Test Plan

Registry vs doc; effective-value sources; harness defaults written;
budget text compared between template and skill.

## Acceptance Traceability

One line per criterion, in `tasks.md` (`## Acceptance Traceability`).

## Commands

```bash
npm test
```
