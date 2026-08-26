# Plan — Story 01-02

## Implementation Context

- **Execution mode**: STRICT — security-relevant (a write-denial mechanism),
  touches install/upgrade flow shared with Claude.
- **Scout pre-step**: yes.
- **Likely files**: `bin/lib/codex-settings.js` (new), `bin/lib/guard.js`
  (read `loadPolicy`/blocked-path list to feed the profile — do not
  duplicate the policy), `bin/ai-flow.js` (`init` `:219-266`, `upgrade`
  `:292-355` — add the Codex call sites alongside the existing
  `ensureHookSettings` ones at `:187,256,345`), `bin/lib/doctor.js`
  (`checkGuardWiring`, currently Claude-only).
- **Reference (adapt, not copy)**:
  `~/dev/tools/ai-learn/bin/lib/platforms/codex-guard.js` (`renderConfig`,
  the TOML shape, the `MARKER` constant) and
  `~/dev/tools/ai-learn/bin/lib/guard.js:626-645` (`ensureCodexGuard`'s
  exact merge contract: `!isGenerated → skipped`, `existing === content →
  no-op`, else full regenerate).

## Technical notes

- The `default_permissions` profile **replaces** Codex's built-in
  workspace-write grants entirely — ai-learn's comment
  (`codex-guard.js:17-20`) warns that omitting a broad read grant (`"/" =
  "read"`) breaks Codex's own ability to exec itself inside the sandbox.
  Carry that grant over; do not drop it to "simplify."
  `.coding-flow/harness.json`'s blocked-path config is the single source of
  truth for what gets denied — read it, do not hardcode a parallel list.
- Marker check is `existing.startsWith(MARKER)`, not a regex or partial
  match — keep it that exact strictness so a human editing the top of the
  file (adding a comment above the marker) is correctly read as "no longer
  ours to touch."

## Decisions

_(filled during implementation)_

## Test plan

- `test/codex-settings.test.js` (new), mirroring `test/hook.test.js`'s
  structure: fresh install writes marker + correct denies; foreign file
  (no marker) is untouched and reported as skipped, not error; stale
  marker-stamped file gets regenerated on `upgrade`; blocked-path list
  changes in `harness.json` are reflected on next `upgrade`.
- Extend `test/doctor-guard-wiring.test.js`'s pattern for the new Codex
  branch: missing profile on a `target: "codex"` project → error; Claude-
  targeted project → this check never fires (regression guard).

## Acceptance traceability

| Criterion | Test |
|---|---|
| fresh init writes correct marker + denies | `test/codex-settings.test.js` |
| foreign file untouched, no error | `test/codex-settings.test.js` |
| upgrade regenerates stale marker-stamped file | `test/codex-settings.test.js` |
| missing profile on codex target → doctor error | `test/doctor-guard-wiring.test.js` (extended) |

## Commands

```
npm test
```
