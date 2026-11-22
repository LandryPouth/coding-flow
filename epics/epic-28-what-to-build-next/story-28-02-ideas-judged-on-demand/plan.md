# Plan — 28-02 Ideas judged on demand

## Implementation Context

- Mode: STANDARD. Scout: no.
- Likely files: `skills/flow-plan/SKILL.md` (opt-in `--ideas` section), the
  `ideas` module of 28-01 (`add`, `rank`, source validation), docs.
- Ground truth for the judge's value: the bethl ledgers written by the
  `epic-run` workflow since 2026-11-14 — which ideas the maintainer planned,
  parked or killed. Read them before writing the skill section.

## Decisions

_(to fill)_

## Test plan

- Unit: `add` rejects missing/invalid sources; `rank` reorders.
- Skill: one recorded run on a fixture repo (eval), asserting sources exist
  and no epic was written.

## Acceptance Traceability

_(to fill)_

## Commands

```
npm test
npm run lint
```
