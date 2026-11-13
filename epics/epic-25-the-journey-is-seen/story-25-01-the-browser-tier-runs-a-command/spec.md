# Story 25-01 — The browser tier runs a command

## User Value

A project with its own browser tests declares one command, and verify runs
it against the app served from the story's worktree: started on a free
port, waited for, stopped after. The browser tier then means "the journey
ran", not "the boxes were ticked".

## Requirements

- `validation.tiers.browser`: `{ command, serve, healthUrl, checklist }`.
  `serve` is the project's dev or start script, run through `ai-flow serve`
  (24-01) on a port from `serve.ports`; `healthUrl` is polled until 2xx (max
  `browser.startTimeoutSec`, default 120); `command` gets `BASE_URL`.
- The served processes are stopped after the tier, pass or fail; a server
  that will not start is a tool error (not a red), naming the last log
  lines.
- With a command declared, the tier's verdict is the command's; the
  checklist, if any, stays as notes for 25-02.
- Heavy: the tier takes a 19-03 verify slot for its whole duration.
- Evidence: command, port, start time, exit, and the command's own report
  path if it writes one (never copied into the repository).

## Acceptance Criteria

- [ ] Given a fixture app and a command that hits `BASE_URL`, when verify
      runs the browser tier, then the app is served on a free port, the
      command passes, and the server is stopped.
- [ ] Given a failing command, then the tier is red and the server is still
      stopped.
- [ ] Given a serve script that never answers `healthUrl`, then the tier ends
      as a tool error with the last log lines, not as a red.
- [ ] Given another worktree's server on the first port of the range, then
      the next free port is used.

## Edge Cases

- A project whose dev server needs a database: the project's script handles
  it; verify only serves and runs.
- Two worktrees running the tier: the 19-03 slots and port allocation keep
  them apart.

## Out of Scope

- Agent-driven checks (25-02).

## Security

- The command is declared in `config.json`, never in a story (unattended
  rule).
- Served processes are the tier's own, stopped by recorded pid (24-01 rule).
