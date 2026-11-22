# Story 21-05 — Plan

## Implementation Context

- **Execution mode**: STANDARD.
- **Likely files**: `templates/.claude/skills/flow-retro/SKILL.md` (new),
  `bin/lib/event-command.js` (new or in `events.js`), `bin/lib/insights.js`,
  `scripts/skill-evals.js`, `evals/` (classification samples),
  `test/events.test.js`, `test/insights.test.js`.
- **Search anchors**: `appendEvent`, `plugin sync`, `skill-evals`.
- **Scout pre-step**: no.
- **Areas to avoid**: the five front-door skills.

## Technical Notes

- Transcripts live under `~/.claude/projects/<encoded cwd>/*.jsonl`; the skill
  reads them with its tools — the CLI never parses transcripts.

## Decisions

- **Categories only**: the metric needs counts, the transcript stays private.

## Test Plan

Event command validation; insights fixtures; skill eval with a small labelled
sample.

## Acceptance Traceability

- 1, 3 → `test/events.test.js::human-turn`
- 2 → `test/insights.test.js::autonomy`
- 4 → `scripts/skill-evals.js`

## Commands

```bash
npm test
```
