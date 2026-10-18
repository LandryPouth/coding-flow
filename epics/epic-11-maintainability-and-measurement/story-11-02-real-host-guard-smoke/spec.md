# Story 11-02 — Real-host guard smoke test

## User Value

Before a release (and after a host upgrade), one command answers "does the
guard still refuse `.env` in Claude Code, OpenCode 1.x and OpenCode 2.x?" —
the question unit tests cannot answer.

## Requirements

- `scripts/smoke-hosts.sh` (bash; documented as Linux/macOS):
  - creates a throwaway `HOME`/`XDG_CONFIG_HOME` and a temp git project;
  - installs this checkout (`node bin/ai-flow.js init --yes` + `--opencode`);
  - for each host binary found on PATH (or given by env var:
    `CLAUDE_BIN`, `OPENCODE_BIN`, `OPENCODE2_BIN`), runs one non-interactive
    prompt asking to create `.env` with `A=1` via the write tool, then one via
    shell redirection;
  - asserts `.env` does not exist and `.coding-flow/denials.jsonl` has the
    expected entries; prints a table host × case → refused / WRITTEN /
    inconclusive (no attempt: no credentials, rate limit, model declined) /
    skipped (binary missing) / ERROR (project not installed);
  - `init` never touches the real HOME; the hosts keep it for their credentials
    (and write their session files there) but never read its global config —
    see tasks.md Findings;
  - exits 1 on any WRITTEN, 2 on ERROR, 3 when nothing was proven (a case
    inconclusive, or every host skipped); only 0 is a pass.
- Needs model credentials: reads them from the real environment only by
  variable name the host already uses; documents that it spends a few cents.
- OpenCode settings from the 2026-10-16 measurement:
  `OPENCODE_DISABLE_MODELS_FETCH=1`; V2 `--standalone` or a free service port.

## Acceptance Criteria

- [x] Run once on the maintainer's machine with all three hosts: table
      recorded in `tasks.md`.
- [x] With a deliberately broken plugin (V1-only file on V2) the script
      reports WRITTEN and exits 1 — proving it detects the 2026-10-16 failure.
- [x] `docs/contributing.md` release checklist includes the script.

## Edge Cases

- Model refusing on its own (never calling the tool) is reported as
  "inconclusive", not "refused" — check `denials.jsonl`, not the absence of
  `.env` alone.

## Status: done

All three hosts refuse both cases; `SMOKE_BREAK=v1` (1.x-only plugin) makes OpenCode 2
write `.env` and the script exit 1. Results in tasks.md.
