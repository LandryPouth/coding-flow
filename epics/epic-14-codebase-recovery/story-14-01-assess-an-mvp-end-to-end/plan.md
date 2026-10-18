# Story 14-01 — Plan

## Implementation Context

- **Execution mode**: STANDARD (new read-only command, new skill; no
  existing verdict changes). Scout pre-step: no.
- **New files**: `bin/lib/recover.js` (scan; layer), `test/recover-scan.test.js`,
  `templates/.claude/skills/flow-recover/SKILL.md`,
  `evals/cases/flow-recover.json`, `evals/recovery/fixture/**`,
  `evals/recovery/expected.md`.
- **Touched**: `bin/ai-flow.js` (dispatch `recover`), `bin/lib/usage.js`
  (machinery group, `help --all` only — not START HERE),
  `bin/lib/skills.js` (listing text: "flow-status, flow-next and
  flow-recover are usable any time"), `templates/CLAUDE.md`,
  `test-support/commands-only-suite.js`, `test/layering.test.js` (LAYER),
  README, `docs/QUICKSTART.md`, CHANGELOG.
- **Reuse**: `bootstrap.scanProject`, `security-policy`
  (`getSecretPatterns`, `findSecretsInContent`, `isHeuristicAllowlisted`),
  `harness-config` (`testGlobs`, `blockedPaths`, `sensitiveGlobs`),
  `util.matchesPattern`. The 2026-10-18 probe script (design doc, *Field
  test*) is the reference algorithm.
- **Avoid**: anything that writes; any network call; printing a matched
  secret value anywhere.

## Decisions

- **Scan in the CLI, inventories in the skill.** The scan is what can be
  computed the same way every time; the inventories need reading, and their
  quality is measured by the fixture replay, not asserted.
- **Fixture is synthetic** — never the private repository it imitates.
- **History scan: exact patterns only.** Heuristics on every historical line
  would bury the signal (the field test's only heuristic hit was wrong).
- **Skill length budget**: assess ≤ ~200 lines; inventories as tables. Long
  prompts are ignored (Uncle Bob study); the scan and the states carry the
  method.

## Test Plan

Behavioural, on throwaway repos: scan JSON shape and contents (criteria
1–3), the never-print-the-secret assertion on both outputs, read-only by tree
token, layering, skill evals. The blind replay is manual and recorded.

## Acceptance Traceability

- 1–3 → `test/recover-scan.test.js`; 4 → `test/layering.test.js`;
  5 → `test/skill-evals.test.js` + `plugin check`; 6 → Result.
