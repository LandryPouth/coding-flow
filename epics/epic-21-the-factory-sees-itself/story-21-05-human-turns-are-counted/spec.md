# Story 21-05 — Human turns are counted

## User Value

The autonomy metric exists: `/flow-retro` reads the local agent transcripts of
the sessions that worked on an epic and records each human message as a
`human.turn` event with a category, so `insights` can tell product decisions
(wanted) from process corrections (the factory's failures). bethl had 1 064
user messages in 117 sessions and no way to split them.

## Requirements

- New skill `/flow-retro` (machinery, not front door; listed in `help --all`
  docs, not in the five front-door skills), in
  `templates/.claude/skills/flow-retro/SKILL.md`, then `plugin sync`.
- Opt-in: it asks before reading transcripts, reads only the local Claude Code
  transcript files of this project's directory for a given date range or epic.
- For each human message it writes one `human.turn` event via `ai-flow event
  human-turn --category <c> --story <dir?> --session <id>` with category
  `product-decision`, `process`, `correction`, `approval` or `info`. No text
  of the message is stored — category, ids and timestamp only.
- `insights` adds: human turns per done story, split by category; process +
  correction turns per story is the autonomy number.
- `ai-flow event human-turn` validates the category enum.

## Acceptance Criteria

- [ ] Given `event human-turn` with an unknown category, then it refuses.
- [ ] Given recorded turns, then `insights` prints turns per done story by
      category.
- [ ] Given an event, then it contains no message text.
- [ ] Given `/flow-retro`, then it asks before reading transcripts, stays
      under 500 lines, and skill evals cover a classification sample.

## Edge Cases

- A message mixing a decision and a correction: classed `correction` (the
  conservative side for autonomy).
- Sessions spanning several epics: turns attach to the story active at the
  time when known, else to the epic.

## Out of Scope

- Automatic classification without the skill; uploading transcripts.
