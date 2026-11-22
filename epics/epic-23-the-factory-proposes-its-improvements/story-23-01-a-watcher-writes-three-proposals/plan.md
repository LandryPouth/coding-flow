# Story 23-01 — Plan

## Implementation Context

- **Execution mode**: STANDARD — walking skeleton: insights → fresh-context
  skill → proposal notes in the vault → listed by `ai-flow proposal list`.
- **Likely files**: `templates/.claude/skills/flow-improve/SKILL.md` (new),
  `bin/lib/proposals.js` (new: schema, write, list, accept/refuse),
  `bin/lib/events.js` (`sample`), `bin/lib/vault.js`,
  `bin/lib/vault-sanitize.js`, `scripts/skill-evals.js`, tests
  `test/proposals.test.js` (new).
- **Search anchors**: `vault.write`, `insights --all`, `readEvents`.
- **Scout pre-step**: no.
- **Areas to avoid**: applying any change to coding-flow.

## Technical Notes

- Pass-scoped cap: `proposal write` takes `--pass <id>`; a pass holds ≤ 3.

## Decisions

- **Numbers in, proposals out**: the watcher never sees the reasoning it
  judges (independence, as STRICT review).

## Test Plan

Schema refusals; pass cap; sample sanitization; skill eval on fixtures.

## Acceptance Traceability

- 1–4 → `test/proposals.test.js`
- 5 → `scripts/skill-evals.js`

## Commands

```bash
npm test
```
