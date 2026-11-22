# Story 27-06 — Plan

## Implementation Context

- **Execution mode**: STANDARD — timed decisions gated by autonomy.md.
- **Likely files**: `bin/lib/packets.js` (new), `bin/lib/answer.js` (new), `bin/lib/run.js`, `skills/flow-run/SKILL.md` (driven mode), tests `test/packets.test.js` (new).
- **Shared identifiers**: `## Needs you` packet, `decide.afterHours`, `ai-flow answer`.
- **Search anchors**: `Needs you`, `Assumption (unconfirmed)`, `autonomy.md`.
- **Scout pre-step**: no.
- **Areas to avoid**: the driver's process invocation (20-01).

## Decisions

- **Off by default**: a timed decision is a delegation the maintainer opts into, per topic.

## Test Plan

Packet parsing; answer flow; clock-injected timed decision; irreversible refusal.

## Acceptance Traceability

- 1–4 → see the test files above.

## Commands

```bash
npm test
```
