# Story 29-02 — The agent is held before it stops

## User Value

An agent working in a project with Coding Flow hears about a placeholder or
an invented import the moment it writes it, and cannot declare itself done
while a blocking finding stands: the `Stop` hook sends it back with the
evidence. When the scan itself breaks, the agent is never blocked by it.

## Requirements

- **Hooks.** `ai-flow harness hook post-edit` (Claude Code `PostToolUse`,
  matcher `Edit|MultiEdit|Write|NotebookEdit`) scans the edited file's added
  lines (29-01, `--changed` restricted to that file); `ai-flow harness hook
  stop` (Claude Code `Stop`) scans the whole `--changed` diff. Both read the
  hook JSON on stdin.
- **Wiring.** `ai-flow harness install|uninstall|status` writes one managed
  block in `.claude/settings.json` next to the guard's (same mechanism as
  `settings.js`); re-running install is byte-identical; uninstall removes only
  that block. `ai-flow init`/`upgrade` offer it, never force it.
- **Modes** (`harness.mode` in `config.json`, `ai-flow harness mode <m>`):
  - `observe`: record only (`.coding-flow/harness-events.jsonl`), exit 0,
    nothing shown to the agent;
  - `feedback` (default): `post-edit` returns the findings as
    `hookSpecificOutput.additionalContext`, exit 0; `stop` blocks once per
    cycle with the findings (exit 2, stderr prefixed `[coding-flow]`);
  - `block`: both exit 2 on a finding at or above `scan.failOn`.
- **Cap.** `harness.maxFeedbackCycles` (default 3) counts `stop` blocks per
  session (`session_id` from the hook input, state in
  `.coding-flow/harness-loop.json`); past the cap, findings are written once
  to stderr as a notice and the agent is let go — never an endless loop. The
  cap and the findings left are recorded in the events file.
- **Silence on failure.** Any tool error (scan exit 2/3, unreadable input,
  missing CLI) is exit 0 with nothing shown, and an `unchecked` event —
  `report` and `doctor` count them like guard limits.
- **Feedback text.** Deterministic, from the scan JSON: severity-ordered
  `[high] path:line rule — message → fix`, at most 10 lines, then
  `… and N more (ai-flow scan)`.
- **Also at Stop**: a story locked in this checkout whose `## Status` says
  `done` without a captured green verify is a blocking item (the claim the
  user should never have to check).

## Acceptance Criteria

- [ ] Given `feedback` mode and an Edit that adds `throw new Error("not implemented")`, when `post-edit` runs, then it exits 0 and its JSON carries the finding in `additionalContext`.
- [ ] Given `feedback` mode and a standing high finding, when `stop` runs three times in one session, then the first three block (exit 2) and the fourth exits 0 with a one-time notice, and the events file records the cap.
- [ ] Given `observe` mode, when either hook runs on a finding, then it exits 0, prints nothing, and appends an event.
- [ ] Given the scan exits 3, when either hook runs, then it exits 0 silently and records `unchecked`.
- [ ] Given `ai-flow harness install` run twice, then `.claude/settings.json` is byte-identical after the second run and user hooks outside the block are kept; `uninstall` restores the file without the block.
- [ ] Given a locked story whose status is `done` with no green verify captured, when `stop` runs, then it blocks and names the story and `ai-flow verify --story <dir>`.

## Edge Cases

- No git repository, no diff base: silent no-op.
- A `Stop` hook re-entered while already blocking (`stop_hook_active`):
  counted against the cap, never more than one block per stop.
- Subagents (`SubagentStop`): out of scope here; 20 drives headless runs.

## Out of Scope

- Cursor/Aider/Codex adapters (the OpenCode and Codex platforms come later,
  through `bin/lib/platforms/`).
- A watch mode.

## Security

The hooks never run project commands, only the read-only scan. Findings may
quote source lines: secret redaction applies as in 29-01.
