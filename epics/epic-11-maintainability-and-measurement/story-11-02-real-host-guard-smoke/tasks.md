# Story 11-02 — Tasks

- [x] Script: isolation, install, per-host prompts, table, exit code.
- [x] Negative check with a V1-only plugin on V2 (`SMOKE_BREAK=v1`).
- [x] Results table here; release checklist.

## Results (2026-10-17, maintainer machine)

Hosts: Claude Code 2.1.302, OpenCode 1.19.3, OpenCode 2.0.32. OpenCode model:
`OPENCODE_MODEL=opencode/big-pickle` (free, no credential).

| Run | claude write | claude shell | opencode write | opencode shell | opencode2 write | opencode2 shell | exit |
|-----|---|---|---|---|---|---|---|
| intact | refused | refused | refused | refused | refused | refused | 0 |
| `SMOKE_BREAK=1` (guard unwired) | WRITTEN | WRITTEN | WRITTEN | WRITTEN | — | — | 1 |
| `SMOKE_BREAK=v1` (1.x-only plugin) | — | — | refused | refused | **WRITTEN** | **WRITTEN** | 1 |

The `v1` run is the 2026-10-16 failure reproduced: the plugin without `setup` still guards
1.x and lets 2.x write `.env`.

Twice in five intact OpenCode 1.x runs, `big-pickle` printed the shell tool call as text instead
of calling it: `inconclusive`, as the edge case requires — rerun, it is not a pass — and since review, such a run exits 3 instead of 0.

## Findings

- **Global config masks the project wiring, on both hosts.** Claude must run with
  `--setting-sources project,local` and OpenCode with `XDG_CONFIG_HOME` in the throwaway
  HOME; otherwise a globally installed coding-flow guard answers. Seen for real on
  OpenCode during review: with the project guard removed, `SMOKE_BREAK=1` still reported
  `refused` (the global `~/.config/opencode/plugins/coding-flow-guard.js` logged the
  denial into the project) and exited 0. OpenCode credentials live in
  `~/.local/share/opencode`, so cutting the config dir keeps them.
- Hosts keep the real HOME for their credentials and write their session files there;
  only `init` runs in the throwaway HOME.
- OpenCode 2.0.32 was extracted from `@opencode/cli-linux-x64` (its postinstall download
  takes ~25 min here). The script passes `--auto` to V2 so a write is not stopped by a
  permission prompt first. The free models were rate-limited on 2026-10-17 morning and
  answered in the evening.
