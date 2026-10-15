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

## Carried over from story 01-02's review

- Observe whether `"deny"` blocks reads as well as writes (the Claude guard only
  blocks writes) and whether glob keys like `**/*.pem` are honoured by Codex's
  matcher; probe at least one glob entry, not only a literal path.
- Record both answers in Decisions below.

## Decisions

Observed against codex-cli 0.138 (a real install, isolated `CODEX_HOME`):

- **Invocation**: `codex sandbox --permissions-profile coding-flow-guard -C <root> -- sh -c 'echo probe > "$1"' sh <file>`. No auth needed.
- **Denial signal**: non-zero exit and `sh: cannot create <f>: Permission denied` (or `Read-only file system` when the target does not exist). The probe also checks the file does not exist afterwards — the file wins over the exit code.
- **Untrusted project**: Codex never loads the project's `.codex/config.toml` and fails with `default_permissions requires a \`[permissions]\` table` before running anything. That is `ok: null` ("is this project trusted in Codex?"), a warning, never a pass or a guard failure.
- **Probe target is a denied DIRECTORY** (`.ssh/` from `.ssh/**`), not a glob entry, and a file inside it that does not exist yet. Created if missing and removed after, whatever the outcome.
- `ok:false` is an error (`codex_sandbox_not_enforcing`); `ok:null` is a warning (`codex_sandbox_unconfirmed`); `ran:false` (no codex, or no directory entry to probe) is silent. Evidence tier is `sandbox` only on `ok:true`.
- Probe runs in `doctor` and `init` (full and minimal-less; not `upgrade`, not `--dry-run`). `doctor` writes a platform record too, deduplicated on (tier, probe), carrying the install record forward.

### Findings about story 01-02's profile (answers to the carried-over questions)

- **`"deny"` blocks reads as well as writes** (`cat a.blocked` → Permission denied). The Claude guard only blocks writes, so under Codex the agent also cannot READ `.env`, `*.pem`, `*.key`, `node_modules/`. Stricter than the Claude side; arguably right for secrets, wrong for `node_modules`.
- **Glob entries only protect files that exist when the sandbox starts.** With `"**/*.blocked" = "deny"`: appending to an existing `a.blocked` / `sub/x.blocked` was denied, but creating a NEW `b.blocked` / `sub/y.blocked` succeeded. So `**/id_rsa`, `**/*.pem`, `**/*.key` (and likely `.env.*`) do not stop an agent creating such a file; only literal paths and directories (`.env`, `.ssh`, `node_modules`) cover creation. This is a real hole in the story 01-02 guard that the probe (directory target) does not and cannot report. Not fixed here: Codex's matcher has no create-time glob; it needs a decision (document the gap, or add a doctor warning for glob-only policies).

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
