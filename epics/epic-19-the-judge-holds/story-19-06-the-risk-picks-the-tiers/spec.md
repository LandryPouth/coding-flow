# Story 19-06 — The risk picks the tiers

## User Value

A project declares its validation in tiers — `fast` (types, lint), `unit`,
`integration`, `e2e`, `browser` — and the story's risk decides which tiers
prove it: a STRICT story runs `integration` when the project has one, a QUICK
copy change does not pay for it. bethl's `test:integration` was never in
verify; STRICT stories ran it by hand, or not (bethl DOGFOODING 2026-11-12
"verify omits test:integration").

## Requirements

- `validation.tiers` in `config.json`: `{ fast: [...], unit: [...],
  integration: [...], e2e: [...], browser: { checklist: "<path or inline>" }
  }`. `validation.commands` keeps working and means `unit` (back-compat).
- Required tiers by risk, in `harness.json` (`tiersByRisk`, defaults:
  low → fast+unit; medium → fast+unit; high/STRICT → fast+unit+integration;
  `e2e` only when the story asks).
- `verify --tier <name>` runs one tier (for agents' narrow checks); the proof
  of a story is the full required set.
- `browser` is a checklist: verify passes the tier when the story's
  `## Browser Check` section has every item ticked with an `observed
  YYYY-MM-DD` line (ties into 18-06's observation rule); missing → the tier
  is `open`, which fails only under strict/driven modes.
- Evidence records tiers run, tiers required, tiers missing.
- A project with no `integration` tier gets one notice line on STRICT
  stories, never a failure.

## Acceptance Criteria

- [ ] Given a STRICT story and a declared integration tier, when verify runs,
      then the integration commands run and are in the evidence.
- [ ] Given a low-risk story, then the integration tier is not run.
- [ ] Given only `validation.commands` (old config), then verify behaves as
      before.
- [ ] Given `verify --tier fast`, then only fast commands run and the result
      is labelled partial (not story proof).
- [ ] Given a browser tier with an unticked item in a driven run, then the run
      is not green and names the item.

## Edge Cases

- A tier command refused unattended (declared in plan.md): same refusal.
- Integration tests needing a database guard (bethl `db-guard.mjs`): the
  project's own script handles it; verify only runs the command.

## Out of Scope

- Browser automation.

## Security

Tiers can only add required commands; a story cannot declare fewer tiers than
its risk requires (risk is read from the diff, entry 1).
