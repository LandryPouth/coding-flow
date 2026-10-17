# Story 11-01 — Split `harness.js` by responsibility

## User Value

A change to coverage rules no longer means reading 3 200 lines that also run
commands and detect secrets; a contributor can test one concern alone. The
guard — the security core, loaded on every tool call — stops loading the whole
verify machinery to read four secret-scan functions.

## Starting point (measured 2026-10-17, `main` at `fe16225`)

- `bin/lib/harness.js`: 3 233 lines, 13 importers (11 modules, 2 test files).
- Already outside it: `coverage.js` (report loading, lcov/istanbul parsing,
  patch measurement, rungs), `diff-base.js` (epic-07's base resolver),
  `policy-fingerprint.js`, `story.js`, `speckit.js`. They stay; the new
  modules sit next to them and require them.
- One cycle: `harness.js` ↔ `policy-fingerprint.js`, worked around with a lazy
  `require` inside `policyFingerprint()`.
- `guard.js` requires `harness.js` for `defaultHarnessConfig`,
  `getSecretPatterns`, `findSecretsInContent`, `isHeuristicAllowlisted`.

## Requirements

- Create these modules under `bin/lib/`; move functions verbatim (plus
  imports), one module per commit. Line numbers are today's, as a map:

  | Module | Takes (today's `harness.js` lines) |
  |---|---|
  | `story.js` (existing) | the shared story readers `resolveProjectPath`, `readStoryBundle`, `extractSection` (530–569, 1089–1122): risk, coverage gate, evidence and the entry points all call them, so they go first to the module everyone may already require |
  | `harness-config` | paths, defaults, `readHarnessConfig`, `ensureHarnessConfig` (55–358) |
  | `security-policy` | secret patterns, allowlist, scans, sensitive paths, `.env` gitignore (360–528) |
  | `diff-scope` | `currentDiffBase`, changed files and added/changed lines, deleted files (1028–1088, 1864–1983, 2180–2237, `addedLinesByFile`) — requires `diff-base.js`, does not replace it |
  | `risk` | story risk, structural git signals, diff risk, `combineRisk`, `scoreCombinedRisk` (570–845, 2636–2656) |
  | `validation-run` | command resolution and execution, timeouts, clean env, cache detection, `captureEnvironment` (1311–1606, 1794–1826) |
  | `coverage-gate` | scoping, patch-coverage evaluation, test weakening, acceptance criteria, floor, contrary signals (1827–2507, 2574–2756) — requires `coverage.js`, does not replace it |
  | `evidence` | preflight and story-evidence check, evidence assembly, fingerprints, reuse, writing (846–977, 1123–1163, 2861–2965) |
  | `harness-report` | every `print*`/`describe*`/`formatLineRanges` (1205–1230, 1607–1793, 2508–2573, 2732–2756) |

  `harness.js` keeps the command entry points (`collectHarnessReport`,
  `harnessInit/Check/Preflight/Evidence/Verify`, `harnessCommand`),
  `verifyStoryOnce` and the story-scope helpers, and re-exports everything it exported before. A function that does
  not fit the map goes where its callers are; record the choice in `plan.md`.
- **Dependency direction** (from `docs/plans/uncle-bob-gauntlet.md`):
  `harness-config` and `security-policy` require neither `harness.js` nor any
  other new module except `harness-config`; `guard.js` imports them directly
  and no longer requires `harness.js`; `policy-fingerprint.js` requires
  `harness-config`, and its lazy `require` goes.
- No behaviour change: no test modified except import paths; the full suite
  green after each commit.
- No circular requires: a fresh `node -e "require('./bin/lib/<m>')"` per
  module (harness.js and each new one) prints nothing on stderr.
- `harness.js` ≤ 600 lines at the end.

## Acceptance Criteria

- [ ] `test/harness-risk.test.js` and `test/harness-verify.test.js` import the
      functions they test from their new modules (`risk`, `harness-config`,
      `diff-scope`, `validation-run`); every other test is unchanged.
- [ ] `git diff -M --color-moved=zebra` per commit shows moves, not rewrites:
      outside import/export lines, no changed line inside a moved function.
- [ ] `npm test` green on every commit of the story.
- [ ] `harness.js` and each new module load alone without stderr output.
- [ ] `grep -n 'require("./harness")' bin/lib/guard.js bin/lib/policy-fingerprint.js`
      finds nothing.
- [ ] `wc -l bin/lib/harness.js` ≤ 600.

## Edge Cases

- `templates.js` imports `ensureHarnessConfig` from `harness.js`: it moves
  first (`harness-config`), so the import points at the leaf.
- `harness.js` → `story.js`/`speckit.js` (core depending on optional layers)
  is **not** fixed here: moves only. Story 12-03's layering test names those
  edges and fixes them by passing data in.
- Hand-written evidence fixtures in tests read `generatedAt` order; moving
  `writeVerifyEvidence` must not change the file name or stamp format.

## Status: planned
