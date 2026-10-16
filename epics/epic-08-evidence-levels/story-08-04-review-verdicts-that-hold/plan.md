# Story 08-04 — Plan

## Implementation Context

- **Execution mode**: STANDARD.
- **Likely files**: `bin/lib/review.js` (capture), `bin/lib/status.js`,
  `bin/lib/audit.js` (`latestReviewByStoryDir`),
  `templates/.claude/skills/flow-review/SKILL.md` → `plugin sync`,
  `evals/cases/flow-review.json`, tests.
- **Areas to avoid**: editing `skills/` directly (generated — AGENTS.md).
