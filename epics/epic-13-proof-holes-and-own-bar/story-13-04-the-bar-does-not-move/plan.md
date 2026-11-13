# Story 13-04 — Plan

## Implementation Context

- **Execution mode**: STANDARD.
- **Likely files**: `bin/lib/harness-config.js` (defaults + read),
  `bin/lib/coverage-gate.js` `evaluateContrarySignals` (~612; mirror
  `readTestExemption` for `## Policy Change`), `bin/lib/harness.js`
  (`--policy-change` flag next to `--test-exemption` ~505),
  `bin/lib/harness-report.js` (print), `bin/lib/usage.js`.
- **Tests**: `test/contrary-signals.test.js` style, throwaway repos.

## Decisions

- **Not judging direction.** Telling a loosened threshold from a tightened
  one needs a parser per format; one declared sentence is cheaper than a
  wrong guess, and entry 9 says the tool never raises a claim on a guess.
- **`policyFingerprint` already detects a `harness.json` change between
  runs**; this signal is about the diff under proof, which the fingerprint
  does not cover.

## Acceptance Traceability

- criteria 1–4 → `test/policy-changed.test.js`

## Decisions (proof, 2026-11-13)

- **Proven with `--base 72dabd5`**, the commit before `2489e3b`: the branch's
  fork point (`develop`) and `develop`'s own recorded `codingFlowBase`
  (`4c7280c`) both lie after the story's code, so neither scope measures it.
  The wide scope (295 files) is the price; `branch.develop.codingFlowBase` is
  left untouched (DOGFOODING 2026-11-10, "verify (proof scope)").
- **The size ratchet held the story's two functions, and the fix is a split,
  not a gate change.** The first verify was NOT PROVEN: `printHelp` 105→106
  (the `--policy-change` line) and `evaluateContrarySignals` 76→94 (this story
  and 13-05's drift both grew it). The reference text moved to a
  `FULL_REFERENCE` constant (help output byte-identical), and the failure
  list moved to `contraryFailures` (same order, same messages; 45 contrary,
  drift and CLI tests green).

## Decisions (independent review, 2026-11-13 — FAIL, fixed)

- **The bar is read at the base.** `policyGlobs` comes from `harness.json` as
  the merge base holds it (`readBaseHarness`, `git show <base>:…`), defaults
  when the base has none; `.coding-flow/harness.json` and `config.json` are
  always listed. A diff that writes `policyGlobs: []` next to
  `minPatchCoverage: 0` is now `policy-changed` and fails under strict. With
  no base at all, the working config is used (nothing to compare against).
  The refactor claim passes its own list (`globs`), already a union that a
  diff cannot shrink.
- **`enforced` reads the base too**: `mode: strict` or
  `failOnContrarySignals` at the base still applies when the diff switches
  them off. It applies to every contrary signal, not only policy-changed —
  stepping down from strict was the same hole for all of them.
- **Renames are not paired** (`--no-renames`): `git mv .eslintrc.json x` is
  the old path leaving.
- **An empty `## Policy Change`** (blanks, or only `<!-- … -->`) gives no
  reason.
- **Test fixtures stopped relying on the hole.** `coverage-floor.test.js`'s
  `setHarness` wrote `policyGlobs: []` into the diff to silence the signal;
  it now commits a floor set before any work into the base (the project's
  standing policy), and leaves a mid-branch edit in the diff.

### Out of scope, recorded

- **The verify cache key ignores `--policy-change`**, as it ignores
  `--test-exemption` (`bin/lib/evidence.js` ~337): a green proof can be
  replayed for a different reason. Earlier and shared defect; not fixed here.
- **Other gates still read `mode` from the working tree** (the coverage
  floor, `resolveCoverageFloor`): only the contrary signals were moved to the
  base. The coverage floor reads `harness.json` as the diff leaves it.

## Decisions (second independent review, 2026-11-13 — FAIL, fixed)

- **Working-tree scope reads HEAD.** With no merge base the diff is the
  working tree against HEAD, so HEAD's `harness.json` is the bar, both for
  `policyGlobs` and for `enforced`. No commit yet: `policy-changed` is not
  computed (no tree token), and `enforced` reads the working tree only.
- **A byte-order mark is stripped** before the base `harness.json` is parsed,
  as `util.readJson` does.
- **An unclosed `<!--` hides the rest of the section**, as rendered Markdown
  would; it gives no reason.
- `coverage-floor`'s "editing the floor invalidates" now asserts the floor
  failure itself (`coverage.floor`), since `policy-changed` also fires there.

### Out of scope, recorded

- **The base itself comes from the tree.** `.coding-flow/config.json`
  `baseBranch` set to the current branch, or `--base HEAD`, yields an empty
  diff and detects nothing. Earlier than this story; the base's source is
  recorded in the evidence (`diffBase.source`).

## Decisions (third independent review, 2026-11-13 — FAIL, fixed)

`failOnContrarySignals` was read at the base, but the risk that arms it was
scored with the tree's config: emptying `highRiskPaths` in the same diff
disarmed it. The risk is now scored with both configs and the higher wins
(`contraryEnforced`, `bin/lib/coverage-gate.js`).

### Inventory: every setting that decides whether `policy-changed` fails

"Base" is `harness.json` at the merge base, or at HEAD in working-tree scope.

| Setting | Decides | Read where | Why a diff cannot lower it |
|---|---|---|---|
| `mode` | `enforced` (strict) | base and tree, either `strict` wins | the base value holds whatever the diff writes |
| `failOnContrarySignals` | `enforced` on high risk | base and tree, either `true` wins | same |
| `highRiskPaths` | risk `high` (paths) | risk scored with the base's and with the tree's, higher wins | the base list still scores the diff |
| `testGlobs` | risk `high` (structural git signals skip test files) | same | a diff that relabels `src/**` as tests is still scored with the base globs |
| `ignoredPaths` | risk `high` (files ignored drop out of the scored diff) | same; `changedFilesForCoverage` takes the scope config | the base scope still sees the files |
| `highRiskTerms` | story risk, capped at `medium` | tree | cannot reach `high`, so cannot arm `failOnContrarySignals` |
| `policyGlobs` | which files trigger the signal | base only (plus the two `.coding-flow/` files, always) | the diff's own list is never read; the refactor claim passes its own union |
| `## Policy Change` / `--policy-change` | lets an enforced signal pass | story text and flag | a declared reason is the design; empty or comment-only does not count |
| diff base (`--base`, `baseBranch`, fork point) | what the diff is | flag, `config.json`, git config | out of scope below: recorded, not fixed |

Every row holding "base" is pinned by a test in `test/policy-changed.test.js`.
The ones for `policyGlobs`, `mode`, `highRiskPaths`, `testGlobs` and
`ignoredPaths` fail on the code before each fix; the `failOnContrarySignals`
step-down test (`9468898`) already passed on the earlier code, where failOn was
read at the base: it pins that behaviour, it did not find a hole.

Known limit: a file renamed away from a high-risk path is scored at its new
path only (follow-up story to be created).
