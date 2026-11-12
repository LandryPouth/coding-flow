# Story 20-05 — Only ready agent stories run

## User Value

The maintainer decides which stories the factory may take: each story says
`Owner: agent` or `Owner: human` (default `human`); the driver runs only ready
`agent` stories; `/flow-next` shows the `human` ones to the maintainer. A
story that needs an answer stops with `## Needs you`, its dependents wait,
and every independent story continues — "pose la question une fois,
regroupée" (bethl bilan P1).

## Requirements

- Story line `Owner: agent|human` in `spec.md` (or `story.md`), parsed by
  `story.js`; absent → `human`.
- `/flow-plan` writes `Owner:` for each story with a one-line reason, and
  never writes `agent` for a story that changes product rules, money,
  production, permissions or personal data without the maintainer's say
  (the `ask` topics of 22-01's defaults).
- Readiness: the driver runs a story only if its epic's `## Readiness` is
  `ready` and the story carries no `Assumption (unconfirmed)` line (story
  16-01's marker).
- `## Needs you` section written by a driven agent: one or more questions,
  each with the options considered and a recommendation; the CLI marks the
  story `blocked (needs you)`; dependents `waiting`.
- The run report groups all `Needs you` questions at the top.
- `/flow-next` lists `human` stories and `needs you` questions first.

## Acceptance Criteria

- [ ] Given a story without `Owner:`, when the driver selects stories, then it
      is skipped as `human`.
- [ ] Given an `agent` story with an `Assumption (unconfirmed)` line, then it
      is skipped as not ready.
- [ ] Given a driven agent writing `## Needs you`, then the story is
      `blocked (needs you)`, its dependents wait, and an independent story
      still runs.
- [ ] Given the run report, then the questions are grouped at the top.
- [ ] Given `/flow-next`, then it shows human stories and open questions
      first.
- [ ] Given `/flow-plan`, then it writes `Owner:` per story; skill evals stay
      green.

## Edge Cases

- An epic marked `not ready` but a story inside it `agent`: not run.

## Out of Scope

- Routing questions to a teammate (24-06).
