# Story 22-01 — The project says who decides

## User Value

A project writes, in one short table, which topics an agent may decide
silently, decide and note, or must ask about — and who owns each topic. The
agent reads it, records each decision it takes with `ai-flow decide`, and the
epic report lists the decisions taken alone. The three levels of the bethl
bilan (*Décide*, *Décide et note*, *Demande*), applied by hand in epic 39
(39-02 D4–D15, 39-03 D9–D19), become the tool's.

## Requirements

- `.coding-flow/autonomy.md`, one Markdown table `topic | level | owner |
  note`; levels `decide`, `decide-and-note`, `ask`; `owner` a role or handle
  (24-06 routes on it). `ai-flow init` writes a commented template; existing
  projects get it from `ai-flow upgrade`.
- Defaults when a topic is absent (built in, printed by `ai-flow decide
  --policy`): `ask` for product or business rules, money, production and
  push, destructive migrations, permissions, external services or cost,
  personal data; `decide-and-note` for deviations from the plan that change
  no product rule; `decide` for process.
- `ai-flow decide --story <dir> --topic <t> --choice "<one line>" [--why
  "<one line>"]`: looks up the level; `decide` records only the event;
  `decide-and-note` records `decision.made` and appends a line to the story's
  `plan.md` `## Decisions` (`D<n> (agent, decide-and-note): …`); `ask`
  refuses and prints how to write `## Needs you` (20-05).
- `/flow-plan` and `/flow-run` read the policy (a short paragraph each) and
  call `ai-flow decide` instead of asking when the level allows.
- The epic report (20-07) and `report` list `decide-and-note` decisions.

## Acceptance Criteria

- [ ] Given a topic at `ask`, when `decide` runs, then it refuses with the
      `## Needs you` instruction and exit 1.
- [ ] Given a topic at `decide-and-note`, then a `decision.made` event exists
      and the story's Decisions section has the new line.
- [ ] Given no `autonomy.md`, then the built-in defaults apply and `decide
      --policy` prints them.
- [ ] Given a malformed table row, then `doctor` names it and the row is
      ignored (fails toward `ask`).
- [ ] Given an epic report, then decisions taken alone are listed.
- [ ] Given `/flow-plan` and `/flow-run`, then they reference the policy,
      stay under 500 lines and evals stay green.

## Edge Cases

- A topic the agent cannot classify: `ask`.
- No policy in SKILL.md frontmatter: the skills read the file at run time.

## Out of Scope

- Precedent search (22-02), routing to owners (24-06).
