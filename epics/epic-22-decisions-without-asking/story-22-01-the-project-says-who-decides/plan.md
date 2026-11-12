# Story 22-01 — Plan

## Implementation Context

- **Execution mode**: STANDARD — walking skeleton: `autonomy.md` → read by
  `/flow-run` → `ai-flow decide` → event + Decisions line → listed in the
  epic report.
- **Likely files**: `bin/lib/autonomy.js` (new: parse, defaults, lookup),
  `bin/lib/decide.js` (new command), `bin/lib/events.js`,
  `bin/lib/run-report.js` (20-07) or `bin/lib/report.js`,
  `bin/lib/doctor.js`, `templates/.coding-flow/autonomy.md` (new),
  `templates/.claude/skills/flow-plan/SKILL.md`,
  `templates/.claude/skills/flow-run/SKILL.md`, tests `test/autonomy.test.js`,
  `test/decide.test.js` (new).
- **Search anchors**: `## Decisions`, `appendEvent`, `doctor`, `templates/.coding-flow`.
- **Scout pre-step**: no.
- **Areas to avoid**: the guard.

## Technical Notes

- Markdown table parsing: pipe-split, trim, header row required; reuse any
  table helper `audit.js` already has.

## Decisions

- **Markdown, not JSON** (epic index assumption): read by humans and agents,
  only looked up by the tool.
- **Fail toward `ask`**: an unreadable policy never widens autonomy.

## Test Plan

Parser table tests; decide per level; doctor on malformed rows; skill evals.

## Acceptance Traceability

- 1–3 → `test/decide.test.js`
- 4 → `test/autonomy.test.js::malformed`
- 5 → `test/run-report.test.js::decisions`
- 6 → `scripts/skill-evals.js`

## Commands

```bash
npm test
```
