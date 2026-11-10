# Story 16-01 — Plan

## Implementation Context

- **Execution mode**: STANDARD. Prose and evals only; no `bin/` change.
- **Likely files**:
  - `templates/.claude/skills/flow-plan/SKILL.md`: `## Clarify First`,
    `### Readiness Gate` and `## Verification`;
  - `templates/.claude/skills/flow-run/SKILL.md`: `## Stop Conditions`. The
    file is at 474 of its 500 lines, so a line added here is paid for by a
    line removed;
  - `evals/cases/flow-plan.json` and `evals/cases/flow-run.json`;
  - `docs/design-decisions.md` (entry 15, after entry 14) and
    `docs/DOGFOODING.md` (the task-5 row, status column only);
  - `skills/` is regenerated with `node bin/ai-flow.js plugin sync`. Never
    edit it by hand.
- **Search anchors**: `Clarify First`, `Readiness Gate`, `Stop Conditions`,
  `task 5`.
- **Scout pre-step**: no.
- **Areas to avoid**:
  - `bin/lib/`;
  - the other skills (story 16-03 rewrites them);
  - the user's uncommitted edits to `docs/DOGFOODING.md` and to epic 15's
    `index.md`.

## Technical Notes

- Pocock's `grilling` source has already been reviewed. Take its mechanics
  (rounds, a recommendation per question, look facts up instead of asking
  them) and not its stance. It is uncapped; ours keeps the budget.
- The pre-0.4 `grill-me` is in `git show c0bb189^:` and is worth reading for
  the wording that the consolidation dropped.

## Decisions

- **A readiness rule, not a new verdict value.** `ready` and `not ready`
  stay the only verdicts, so nothing that reads them changes.
- **The `Assumption (unconfirmed)` marker is plain text.** No parser reads
  it. It is for `/flow-run` and the reviewer to see. A mechanical check comes
  later, only if the benchmark shows the prose is ignored.

## Test Plan

Tiers 1 and 2 of the skill evals, plus `test/ceremony.test.js` (the 500-line
ceiling), both run by `npm test`. The behaviour itself is measured in story
16-03 by the benchmark (task 5).

## Acceptance Traceability

- 1–3 → `evals/cases/flow-plan.json`, `evals/cases/flow-run.json`
  (`scripts/skill-evals.js`)
- 4 → `npm test` (`test/ceremony.test.js`, `plugin check`)
- 5 → review of `docs/design-decisions.md`

## Commands

```bash
npm test
```
