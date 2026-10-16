# Story 08-01 — The coverage rung gates `ok`

## User Value

In a project that asks for it, a high-risk story is not "verified" because a
test file was touched; it is verified when the added lines were measured.

## Requirements

- `harness.json` `coverageFloor`: `{ high, medium, low }`, each one of
  `verified | evidence | exempted | not-required`. Missing key → mode
  defaults (epic Decisions).
- Rung order for comparison: `verified` > `evidence` > `exempted` >
  `not-required`; `missing` always fails (today).
- After coverage is evaluated, if the story's combined risk level requires a
  higher rung than reached, `coverage.ok = false`, `coverage.tier` stays the
  reached rung, and `coverage.floor = { required, reached }` explains it.
  `exempted` satisfies any floor (a written reason is the documented escape),
  but is shown as such.
- `status` shows the rung per story (`verified`, `evidence`…), `ship`'s PR body
  states it, `audit` counts runs per rung.

## Acceptance Criteria

- [ ] Default standard config, high risk, `test-file` mode → `ok: true`,
      tier `evidence` (unchanged behaviour).
- [ ] `mode: strict`, high risk, `test-file` mode → `ok: false`, reason names
      the floor and how to reach it (emit a coverage report, or exempt).
- [ ] `mode: strict`, high risk, fresh lcov covering the added lines →
      `verified`, `ok: true`.
- [ ] `coverageFloor.medium: "verified"` explicit in standard → applies.
- [ ] Exemption on a strict high-risk story → `ok: true`, tier `exempted`.
- [ ] `status --json` exposes `coverageTier`; `ship --dry-run` PR body
      contains the rung.

## Edge Cases

- Evidence written by older versions has no `floor`: readers derive the tier
  with `coverageTier()` as today and treat the floor as "unknown", never as
  failed.
