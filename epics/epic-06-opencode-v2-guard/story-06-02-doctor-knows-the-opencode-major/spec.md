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

- [ ] Given a fake `opencode` printing `2.0.30` on PATH and a plugin generated
      by 0.12.1, when `doctor` runs, then it reports the guard as not loaded
      and exits non-zero (same severity as other broken-guard checks).
- [ ] Given the same fake binary and a plugin generated after 06-01, then the
      guard line is OK.
- [ ] Given a fake `opencode` printing `1.19.0` and a 0.12.1 plugin, then the
      existing stale warning appears, not the V2 failure.
- [ ] Given no `opencode` binary, then `doctor` does not fail on this check.

## Edge Cases

- `opencode --version` output formats (`2.0.30`, `opencode 2.0.30`,
  `v2.0.30`) all parse; anything else → "version unknown", treated as 1.x.
- The check must not start an OpenCode service (V2 auto-starts one for some
  subcommands; `--version` must be the only invocation).
