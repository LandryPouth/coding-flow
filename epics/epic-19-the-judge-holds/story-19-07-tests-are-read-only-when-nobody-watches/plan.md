# Story 19-07 — Plan

## Implementation Context

- **Execution mode**: STRICT — guard.
- **Likely files**: `bin/lib/guard.js` (`decide`, `decideBash`, `evaluate`),
  `bin/lib/shell-writes.js`, `bin/lib/harness-config.js` (`testGlobs`),
  `bin/lib/diff-base.js` (base resolution), `bin/lib/evidence.js` (backstop),
  `templates/.claude/skills/flow-run/SKILL.md`; tests
  `test/guard.test.js`, `test/guard-adversarial.test.js`,
  `test/guard-shell.test.js`, `test/weakened-tests.test.js`.
- **Search anchors**: `decide(`, `testGlobs`, `weakened`, `codingFlowBase`.
- **Scout pre-step**: no.
- **Areas to avoid**: the guard's module graph — `diff-base.js` must not pull
  heavy modules onto the guard path (`test/guard.test.js` pins it).

## Technical Notes

- Base resolution must not use a SHA `codingFlowBase` wrongly recorded on the
  base branch (coding-flow DOGFOODING 2026-11-10 *verify (proof scope)*): in
  driven runs the driver passes the base explicitly (`AI_FLOW_BASE`).
- OpenCode/Codex guards: same rule where their guard path supports it;
  otherwise the verify backstop is the protection, documented.

## Decisions

- **Mechanical first, prose second**: the prose rule alone was measured to fail
  on Claude models in ImpossibleBench.

## Test Plan

Guard matrix (edit, write, delete, rename, shell `sed -i`, `rm`) × (base test,
new test, exempted) × (driven, interactive); env-unset bypass attempt;
verify backstop.

## Acceptance Traceability

- 1–4 → `test/guard-adversarial.test.js::protected tests`
- 5 → `test/weakened-tests.test.js::protected test changed`
- 6 → `scripts/skill-evals.js` via `npm test`

## Commands

```bash
npm test
```
