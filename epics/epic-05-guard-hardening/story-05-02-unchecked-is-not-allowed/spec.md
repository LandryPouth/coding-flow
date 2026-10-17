# Story 05-02 — "Unchecked" is not "allowed"

## User Value

When the guard could not check a write, the developer can see it — how many,
which tool, why — instead of reading silence as protection.

## Requirements

- `decide`/`evaluate` return `decision: "allow" | "deny" | "unchecked"`.
  `unchecked` is returned for:
  - an exception inside `decide` (today: `allow` "failing open");
  - an unparseable or empty hook input;
  - a tool name that is not in the known read-only set **and** whose input
    carries a path-like field (`file_path`, `path`, `filePath`,
    `notebook_path`) — a write tool we do not know yet; tools with no path
    field stay `allow` (Read, Grep, web tools…);
  - a path whose resolution failed (05-01 edge case: ELOOP, EACCES).
- Hosts in `standard` mode treat `unchecked` like `allow` (no behaviour change
  for the agent): the Claude hook exits 0, the OpenCode plugin does not throw.
- Every `unchecked` is appended to `.coding-flow/guard-unchecked.jsonl`
  (same bounded, never-throwing writer as `recordDenial`; never the content,
  never a secret).
- `ai-flow report` gains an "Unchecked writes" count + top reasons;
  `ai-flow doctor` shows a warning when the log has entries in the last 7
  days; `ai-flow status` is unchanged.
- The OpenCode plugin's "could not run" branch (`spawnGuard` error) and "no
  local module and no fallback" are `unchecked` too, logged the same way when
  the project has `.coding-flow/`.

## Acceptance Criteria

- [x] Given `evaluate(null, root)`, then `decision: "unchecked"` and a reason.
- [x] Given `decide` throws (inject a policy file that is a directory), then
      `evaluate` returns `unchecked`, not `allow`, and a line is logged.
- [x] Given the OpenCode plugin receives a known write tool (`write`, `edit`,
      `patch`, `shell`) whose arguments resolve no path or command (e.g. V2
      renames `path` or `patchText`), or an unknown one like `multiedit`, then
      `unchecked` with a stderr "NOT checked" line, not a silent allow (found
      by the 06-01 STRICT review).
- [x] Given tool `MultiEdit2` with `{ file_path: ".env" }`, then `unchecked`;
      given tool `Read` with `{ file_path: ".env" }`, then `allow`.
- [x] Given `ai-flow guard` (Claude hook) receives an unchecked case, then
      exit code 0 and the log has one line.
- [x] Given three unchecked lines, then `report` shows the count and reasons
      and `doctor` warns.
- [x] Given a deny, then nothing is written to the unchecked log (denials keep
      their own file).

## Edge Cases

- **Noise**: the known read-only set must include Claude Code's and
  OpenCode's read tools (Read, Glob, Grep, LS, WebFetch, WebSearch, Task,
  TodoWrite, read, glob, grep, list, webfetch, todowrite, skill…) so
  everyday use logs nothing. A test asserts a normal session's tool names
  produce zero lines.
- **Privacy**: same redaction as `denials.jsonl` (relative path, no home).

## Status: done

## Result

`decide`/`evaluate` return a third outcome, `unchecked` (logged to `.coding-flow/guard-unchecked.jsonl`, exit 0 / no throw): no parseable input, an exception, an unknown tool carrying a path, a write tool with no path or a Bash call with no readable command, an unresolvable path (ELOOP, EACCES). The OpenCode plugin reports an unreadable write/patch, an unknown path-bearing tool, a spawn failure and a missing module as "NOT checked". `report` shows the count and top reasons; `doctor` warns on entries from the last 7 days.

Deviation: a `harness.json` that is a directory does not make `decide` throw (`loadPolicy` already degrades to defaults), so the exception case is tested with a hook whose field throws.

Second deviation: `mcp__*` tools and the `Artifact*` tools are not counted as unknown write tools (they would bury the real unknowns in noise). Claude Code never sends MCP tools to the guard (the hook matcher is `Write|Edit|MultiEdit|NotebookEdit|Bash`), so the exemption only matters to OpenCode. A path outside the project is logged as `(outside project)`, and a spawned guard prints its "NOT checked" line on stderr so the OpenCode fallback can forward it.

Review follow-up (2026-10-17): a spawned guard that exits with neither 0 nor 2 (crash, signal, offline npx) was a silent allow in the OpenCode fallback; it is now "NOT checked" and logged. A non-string path no longer drops its unchecked line, and the plugin's fallback log is bounded.
