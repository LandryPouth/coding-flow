# Story 22-04 — Plan

## Implementation Context

- **Execution mode**: STANDARD — dogfooded on bethl.
- **Likely files**: `templates/.claude/skills/flow-retro/SKILL.md`,
  `bin/lib/autonomy.js` (row append), `bin/lib/decisions.js` (append with
  provenance), `evals/` (memory fixtures), `scripts/skill-evals.js`.
- **Search anchors**: `flow-retro`, `decisions.jsonl`, `autonomy.md`.
- **Scout pre-step**: no.
- **Areas to avoid**: the user's memory files (read only).

## Technical Notes

- Memory path: `~/.claude/projects/<encoded cwd>/memory/`; the skill reads it,
  the CLI does not.

## Decisions

- **One item, one approval**: bulk import would launder unreviewed rules into
  the repo.

## Test Plan

Skill evals on fixtures; manual bethl pass.

## Acceptance Traceability

- 1–3 → `scripts/skill-evals.js`
- 4 → observed YYYY-MM-DD in `## Result`

## Commands

```bash
npm test
```
