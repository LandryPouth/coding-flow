# Story 27-06 — Questions arrive as decision packets

## User Value

A question costs the maintainer one glance and one tick: context, options,
the recommended one, the consequence of each; and when the project allows,
an unanswered reversible question does not hold the epic forever.

## Requirements

- `## Needs you` gains a packet shape: two-line context, 2–4 options as
  `- [ ]` lines, one marked `(recommended)`, a consequence per option, what
  waits on it. `/flow-run` driven mode writes it; a free-text question is
  turned into a packet by the CLI with a single "answer in text" option.
- `ai-flow answer <story> <n|text>` ticks the option, clears the hold,
  re-queues the story (20-06 content-hash resume).
- Timed decisions: `decide.afterHours` (default unset = never). When set
  and `autonomy.md` allows the topic, the recommended option is taken,
  marked `Assumption (unconfirmed)` (16-01), listed in the report. Never
  for topics `autonomy.md` marks irreversible (data deletion, production,
  money, permissions).

## Acceptance Criteria

- [ ] Given a driven agent's question, then the story has a packet with
      options and one recommended.
- [ ] Given `ai-flow answer <story> 2`, then option 2 is ticked, the hold
      clears and the story is queued.
- [ ] Given `decide.afterHours: 12`, an allowed topic and no answer after 12
      hours, then the recommended option is taken and marked
      `Assumption (unconfirmed)`.
- [ ] Given an irreversible topic, then no timed decision is ever taken.
