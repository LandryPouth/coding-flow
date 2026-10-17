# Story 10-02 — Commands from `plan.md` need a human

## User Value

A validation command an agent wrote into a story never runs unattended with
the developer's (or the CI runner's) secrets.

## Requirements

- When `resolveValidationCommands` returns `source: "plan.md"`:
  - interactive TTY → run, after printing `Running commands from plan.md
    (not from .coding-flow/config.json):` and the list;
  - non-TTY, `CI=true`, or called from `autoland`/`worktree land` → refuse
    (`ok: false`, reason "commands from plan.md are not run unattended;
    declare them in .coding-flow/config.json or pass
    --allow-plan-commands"), unless `--allow-plan-commands`.
- `--clean-env` (any source): the child environment drops variables whose
  **names** match `/(SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE|CREDENTIAL|API_?KEY|ACCESS_?KEY)/i`,
  keeps `PATH`, `HOME`, `CI`, `NODE_*`, `npm_*`. Recorded in evidence
  (`environment.cleaned: true`, names only).
- Evidence records `commandSource` (exists) and `unattended: true|false`.

## Acceptance Criteria

- [x] Story with `plan.md` commands, no config, `CI=true` → refused, nothing
      executed (assert a marker file is not created).
- [x] Same with `--allow-plan-commands` → runs.
- [x] Same in a TTY (simulate via the existing test helper or a flag) → runs
      with the notice.
- [x] Config commands under `CI=true` → run as today.
- [x] `--clean-env` with `MY_API_KEY=x` in the parent → the child does not see
      it (command prints `$MY_API_KEY`), `PATH` still works.

## Edge Cases

- TTY detection: `process.stdin.isTTY && process.stdout.isTTY`; agents run
  without a TTY — so an agent-driven `/flow-run` verify with plan commands is
  refused unless allowed. This is intended; the message tells the agent to
  move the commands to config with the user's agreement.
