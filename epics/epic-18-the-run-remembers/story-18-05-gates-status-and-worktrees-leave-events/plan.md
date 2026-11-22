# Story 18-05 — Plan

## Implementation Context

- **Execution mode**: STANDARD.
- **Likely files**: `bin/lib/evidence.js` and `bin/lib/coverage-gate.js`
  (gate verdicts), `bin/lib/harness.js` (verify end), `bin/lib/worktree.js`
  (`worktreeLock`, `worktreeUnlock`, `worktreeLand`, `worktreeRemove`,
  `conflictingFiles`), `bin/lib/worktree-plan.js` (placement),
  `bin/lib/review.js`, `bin/lib/events.js`; tests next to each.
- **Search anchors**: `NOT PROVEN`, `contrary`, `worktreeLock`,
  `conflictingFiles`, `decidePlacement`.
- **Scout pre-step**: no.
- **Areas to avoid**: the guard path (no events from `guard`; `denials.jsonl`
  already records denials).

## Technical Notes

- Gate outcome inference runs at the start of the next verify of the same
  story: compare the previous `gate.fired` with what changed since.
- Run after 18-02 when both are open: same `worktree.js` edit points.

## Decisions

- **Readers never write events.** `status`, `next`, `report` stay pure.

## Test Plan

One fixture per event family; the gate outcome sequence (fire → test added →
green) end to end on a throwaway repo.

## Acceptance Traceability

- 1–2 → `test/events-gates.test.js` (new)
- 3–4 → `test/worktree.test.js::events`
- 5 → `test/status.test.js::status writes nothing`

## Commands

```bash
npm test
```
