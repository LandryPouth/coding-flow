# Story 20-04 — Plan

## Implementation Context

- **Execution mode**: STRICT.
- **Likely files**: `bin/lib/drivers/claude.js`, `bin/lib/run.js`,
  `bin/lib/review.js` (`found --from`, `resolve`), `bin/lib/worktree.js`
  (unlock), `bin/lib/worktree-plan.js` (autoland),
  `templates/.claude/skills/flow-review/SKILL.md` (findings JSON when driven),
  tests `test/run-driver-claude.test.js`, `test/review.test.js`.
- **Search anchors**: `reviewCapture`, `autoLandIfChainFinished`,
  `worktreeUnlock`.
- **Scout pre-step**: no.
- **Areas to avoid**: interactive `/flow-review` behaviour.

## Technical Notes

- A second process gives genuine independence; a subagent in fork mode would
  inherit the worker's context (2026-11-10 notes).

## Decisions

- **One fix pass, one verify**: "never verify while the code changes"; more
  passes raise cheating.

## Test Plan

Stub reviewer/fixer scenarios: clean, P1 fixed, P1 left open, malformed JSON.

## Acceptance Traceability

- 1–5 → `test/run-driver-claude.test.js::review loop`

## Commands

```bash
npm test
```
