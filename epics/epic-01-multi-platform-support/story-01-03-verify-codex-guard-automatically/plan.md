# Plan — Story 01-03

## Implementation Context

- **Execution mode**: STRICT — shells out to an external binary
  automatically on every `doctor`/`init`; correctness of the pass/fail
  read directly determines whether users are told a false "protected".
- **Scout pre-step**: yes.
- **Likely files**: `bin/lib/codex-probe.js` (new, the `spawnSync`
  wrapper + interpretation logic), `bin/lib/doctor.js` (call the probe,
  render its three-way message), `bin/ai-flow.js`'s `init` (call the probe
  once after `codex-settings.js` wiring), the platform-evidence writer from
  story 1 (extend the record shape with `probe`).
- **Reference**: the exact command shape is documented (not implemented) in
  `~/dev/tools/ai-learn/bin/lib/platforms/codex-guard.js:9-15`; the
  auto-skip-on-missing-binary pattern to promote from test-only to shipped
  behavior is `~/dev/tools/ai-learn/test/integration-opencode.test.js`'s
  `opencodeAvailable()` (`execFileSync("opencode", ["--version"], {stdio:
  "ignore"})` in a try/catch).

## Technical notes

- Use `child_process.spawnSync` with an explicit `timeout` option (Node's
  native subprocess timeout) rather than a hand-rolled race — simpler and
  matches the "insurance timeout, not a tight budget" reasoning already used
  for `GUARD_TIMEOUT` (`settings.js:37-41`).
- Binary-presence check should reuse `isCommandAvailable` from `util.js`
  (already used elsewhere, e.g. `doctor.js`'s `binaryPathNote`) rather than
  a bespoke `try { execFileSync(...) } catch` — check whether it already
  covers "any binary on PATH" generically or is `ai-flow`-specific before
  deciding to extend vs. reuse.
- The three probe outcomes (`ok: true`, `ok: false`, `ok: null` for an
  unrelated Codex failure) must be distinguishable from the probe command's
  raw exit code alone — likely needs the probe command's stdout/stderr
  inspected for a recognizable "permission denied"/`EPERM`-class signal
  versus some other Codex-side error. Confirm the actual signal Codex's
  sandbox emits on denial during implementation (this may need a real local
  `codex` install to observe once, the same way ai-learn's author did) and
  record it in Decisions.

## Decisions

_(filled during implementation — record the exact denial signal observed
from `codex sandbox`, and the final probe-command construction)_

## Test plan

- `test/codex-probe.test.js` (new): a `spawnSync`-mocking test for the
  three outcomes (denied / not-denied / unrelated-failure) driving the
  interpretation function in isolation — does not require a real `codex`
  binary, so it always runs.
- An integration test gated the same way as ai-learn's OpenCode test
  (`{skip: !available}`) that runs the real probe against a real `codex`
  installation when present in CI/dev — auto-skips elsewhere.
- `doctor.js` test: the three human-readable messages (confirmed-working /
  confirmed-broken / not-checked) each appear for their respective probe
  outcome, and confirmed-broken is an **error** (exit code 1), never a
  warning.
- Timeout test: a probe that hangs past its timeout does not hang `doctor`.

## Acceptance traceability

| Criterion | Test |
|---|---|
| probe passes → evidence `probe.ok: true` | `test/codex-probe.test.js` (integration) |
| profile misconfigured → doctor error, `probe.ok: false` | `test/codex-probe.test.js` (integration) |
| codex absent → no spawn, `probe.ran: false`, no error | `test/codex-probe.test.js` (unit) |
| report shows confirmed enforcement tier | extend `test/report-platform-coverage.test.js` |
| bounded runtime, no hang | `test/codex-probe.test.js` (timeout case) |

## Commands

```
npm test
```
