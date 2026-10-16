# Story 06-02 — `doctor` knows which OpenCode major the guard must fit

## User Value

After an OpenCode upgrade, `ai-flow doctor` says "the guard is not loaded by
OpenCode 2 — run `ai-flow upgrade`" instead of reporting a healthy install.

## Requirements

- `doctor` runs `opencode --version` (short timeout, never fails when the
  binary is absent) and parses the major.
- For the project plugin and the global one (`~/.config/opencode/plugins/`),
  `doctor` checks whether the file is ours (MARKER) and whether it carries the
  V2 entry (a stable token such as `id: "coding-flow.guard"`).
- On a 2.x host, a plugin without the V2 entry is a **failure** line ("guard
  not loaded on OpenCode 2"), with the command to run (`ai-flow upgrade` for
  the project, `ai-flow upgrade --global` for the global copy). On 1.x it is
  the existing "stale" warning.
- No `opencode` on PATH: one informational line, no failure.

## Acceptance Criteria

- [x] Given a fake `opencode` printing `2.0.30` on PATH and a plugin generated
      by 0.12.1, when `doctor` runs, then it reports the guard as not loaded
      and exits non-zero (same severity as other broken-guard checks).
- [x] Given the same fake binary and a plugin generated after 06-01, then the
      guard line is OK.
- [x] Given a fake `opencode` printing `1.19.0` and a 0.12.1 plugin, then the
      existing stale warning appears, not the V2 failure.
- [x] Given no `opencode` binary, then `doctor` does not fail on this check.

## Edge Cases

- `opencode --version` output formats (`2.0.30`, `opencode 2.0.30`,
  `v2.0.30`) all parse; anything else → "version unknown", treated as 1.x.
- The check must not start an OpenCode service (V2 auto-starts one for some
  subcommands; `--version` must be the only invocation).

## Result

- `opencode.js` exports `pluginHasV2Entry`, `parseOpenCodeMajor` and `probeOpenCode`
  (`opencode --version` only, 5 s timeout, never throws). `doctor` adds
  `opencode_guard_not_loaded` (error) for a stale project plugin without the V2
  entry on a 2.x host, and `opencode_global_guard_not_loaded` (error) for the
  global copy, naming `upgrade` / `upgrade --global`. 1.x keeps the stale warning;
  no binary adds a note, never a failure. Unparseable output counts as 1.x.
- Tests: `test/doctor-opencode-major.test.js`, fake `opencode` on an isolated
  `PATH` that logs its calls (proves `--version` is the only invocation).
- Verify: green; `Coverage: evidence`. `harness check` still reports the three
  known fake-key shapes in `test/guard.test.js` / `test/harness.test.js` (see
  DOGFOODING 2026-08-24), none touched here.

### Rollback Notes

`git revert` of the commit; doctor goes back to reporting a pre-06 plugin on 2.x as
a warning.

## Status: done
