# Story 23-03 — Plan

## Implementation Context

- **Execution mode**: STRICT — policy.
- **Likely files**: `bin/lib/harness-config.js`, `bin/lib/evidence.js`
  (verdict assembly), `bin/lib/coverage-gate.js` and other gates,
  `bin/lib/guard.js` (protect `harness.json` under `AI_FLOW_DRIVEN`),
  `bin/lib/insights.js`, `bin/lib/doctor.js`, tests
  `test/harness-verify.test.js`, `test/shadow-gate.test.js` (new),
  `test/guard.test.js`.
- **Search anchors**: `gate.fired`, `harness.json`, `verdict`.
- **Scout pre-step**: yes — list every gate and where its verdict enters the
  overall verdict.
- **Areas to avoid**: gate logic itself.

## Technical Notes

- Keep the guard's module graph pinned (test/guard.test.js): the protected
  path check stays inside guard.js.

## Decisions

- **Default `blocking`**: zero change for existing projects.

## Test Plan

Verify fixtures with a failing shadow gate; guard deny under driven env;
insights threshold.

## Acceptance Traceability

- 1–3 → `test/shadow-gate.test.js`
- 4 → `test/insights.test.js::shadow ready`
- 5 → `test/guard.test.js::harness.json driven`

## Commands

```bash
npm test
```
