# Story 11-02 — Plan

## Implementation Context

- **Execution mode**: STANDARD.
- **Likely files**: `scripts/smoke-hosts.sh`, `docs/contributing.md`.
- **Technical notes**: Claude Code non-interactive: `claude -p "<prompt>"
  --permission-mode acceptEdits` in the temp project; OpenCode: `opencode
  run "<prompt>"` (V1) / V2 equivalent (check `opencode --help` on 2.x).
  The OpenCode 2 binary can be extracted from `@opencode/cli-linux-x64` when
  the `@opencode/cli` postinstall cannot download it (seen 2026-10-16).
