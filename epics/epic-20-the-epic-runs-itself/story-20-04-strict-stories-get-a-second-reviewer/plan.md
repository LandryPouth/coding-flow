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

- **One fix pass, one verify per round**: "never verify while the code
  changes"; more passes inside a round raise cheating.
- **Fresh reviewer for every round, consecutive clean rounds for STRICT
  (2026-11-22, maintainer):** a re-review by the reviewer that found the
  defects passed stories that the next fresh reviewer failed. Seen in the
  unattended run: 13-09 needed 5 reviews (13 P1), 13-13 three (6 P1), and a
  fix to PR #59's CI opened a P1 its narrow re-review would not have looked
  for. One review is a sample, not a proof; the cap (4) turns a review that
  never converges into a signal about the story's size.

## Test Plan

Stub reviewer/fixer scenarios: clean, P1 fixed, P1 left open, malformed JSON.

## Acceptance Traceability

- 1–5 → `test/run-driver-claude.test.js::review loop`

## Commands

```bash
npm test
```
