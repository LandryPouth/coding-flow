# Story 26-06 — The rules are printed with their source

## User Value

`ai-flow rules` prints every rule's effective value on this machine and in
this project, and where it came from — default, project config, user
config, or `auto` with the reason — so nobody learns a limit by hitting
it. `docs/rules-and-limits.md` (2026-11-13) is kept true by a test, and the
code inconsistencies it found are fixed.

## Requirements

- One registry, `bin/lib/rules-registry.js`: key, default, cap or
  threshold, scope (`project` / `user` / `auto`), doc line. Config readers
  take their defaults from it.
- `ai-flow rules [--json] [<key>]`: effective value, source, cap. `doctor`
  points to it.
- A test checks that every registry key appears in
  `docs/rules-and-limits.md` with the same default.
- Fixes from the doc's *Inconsistencies found*:
  - one command-timeout constant (today `validation-run.js:206` and
    `worktree.js:744`), and the stale comment at `worktree.js:729`;
  - `coverageFloor` and `failOnContrarySignals` written by
    `defaultHarnessConfig()` (moved to 26-08);
  - `templates/RULES.md` and `skills/flow-run` state the same context
    budgets; `skills/flow-plan` says "warned above 7" for epic size.

## Acceptance Criteria

- [x] Given no config, then `ai-flow rules` lists every registry key with
      source `default`; given a project value, then source `project`.
- [~] Given WSL, then `run.maxAgents` shows `auto: WSL detected → 2`.
      *Deferred to 24-02 (plan.md D2): the key is not shipped, and the edge
      case below keeps planned keys out. The `auto` source ships with
      `coverageFloor.high` (`auto: mode standard → evidence`).*
- [x] Given a registry default changed without the doc, then the doc test
      fails and names the key.
- [x] Given the land lock sizing, then it reads the single timeout constant.
- [~] Given `init`, then `harness.json` contains `coverageFloor` and
      `failOnContrarySignals` with their defaults.
      *Moved to story 26-08 at the review cap (plan.md, Split): writing the
      keys moves the policy fingerprint of proofs already recorded.
      `ai-flow rules` shows both, with their source, today.*
- [x] Given `templates/RULES.md` and `skills/flow-run/SKILL.md`, then their
      context budgets match.

## Edge Cases

- A key planned but not shipped (epics 18–25): not in the registry until
  its story ships; the doc keeps it in *Planned*.

## Out of Scope

- Changing any default's value.

## Security

- `rules` prints no env values; secret-looking keys are never registered.
