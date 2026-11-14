# Story 29-04 — Destructive commands wait for the human

## User Value

An agent cannot run a command that throws away work or history — a hard
reset, a forced push, a cleaned tree, a branch switch in the main checkout,
a reset database — on its own judgment. The guard refuses it before it runs,
says what it would destroy, and names the safe command or the human step.
agentic-os can only ask for this in prose ("only an operator-owned harness
wrapper can intercept"); the guard is that wrapper.

## Requirements

- **Refused by default** (Bash tool, read through `shell-writes.js`'s
  segment and word reader, every segment of a compound command):

  | Command | Safe alternative named in the refusal |
  |---|---|
  | `git reset --hard`, `git checkout -- .` / `git restore .` on a dirty tree | `git stash push -u -m <why>` |
  | `git clean -f…` | `git clean -n` to list, then the human decides |
  | `git push --force` / `-f` / `--force-with-lease` / `+refspec` | stop and ask the human |
  | `git checkout <branch>` / `git switch` / `git rebase` / `git merge` in the **primary checkout** (`--git-dir` equals `--git-common-dir`) when `worktrees.primaryLocked` is true | `ai-flow worktree add --story <dir>` |
  | `git branch -D`, `git worktree remove --force`, `git stash drop/clear` | the non-forced form |
  | `rm -rf` / `rm -r` (any flag order) | `trash <path>` when `trash` is on PATH |
  | `prisma migrate reset`, `prisma db push --force-reset` / `--accept-data-loss`, `dropdb`, `DROP DATABASE` in a `psql -c` | stop and ask the human |
  | `docker system prune`, `docker volume rm/prune` | stop and ask the human |
  | a download piped to a shell (`curl … \| sh`, `wget -O- … \| bash`) | download, read, then run |

- **Refusal text** names the rule, what it would destroy (untracked and
  ignored files included), and the alternative; it is recorded in
  `denials.jsonl` like other guard denials.
- **Policy** lives in `.coding-flow/harness.json` (already a path the agent
  cannot write): `destructiveCommands: "deny" | "warn" | "off"` (default
  `deny`), `allowDestructive: ["<exact command prefix>"]`,
  `worktrees.primaryLocked` (default `false`; bethl sets `true`). The agent
  cannot lift a refusal by environment variable, flag or wrapper
  (`bash -c`, `sh -c`, `env`, `xargs`, `eval` are read through, as the guard
  already does for writes).
- **Fail-open is recorded.** A command the reader cannot parse (expansion,
  heredoc into an interpreter) is allowed and recorded as `unchecked`, the
  existing guard rule (design-decisions entry 14) — never a silent pass.
- `/flow-run` gains one line: a destructive step is a `## Needs you` with its
  blast radius and rollback, never a workaround.

## Acceptance Criteria

- [ ] Given `git reset --hard HEAD~1`, when the guard evaluates it, then it is denied with the rule, the files at risk and `git stash push -u` as the alternative, and a line is appended to `denials.jsonl`.
- [ ] Given `cd repo && git push origin +main`, when the guard evaluates it, then it is denied (the `+refspec` form).
- [ ] Given `worktrees.primaryLocked: true` and `git switch develop` run in the primary checkout, then it is denied; the same command in a linked worktree is allowed.
- [ ] Given `bash -c "rm -rf build"`, then it is denied and the refusal names `trash build`.
- [ ] Given `npx prisma migrate reset --force`, then it is denied.
- [ ] Given `allowDestructive: ["git clean -fdX"]` in `harness.json`, then exactly that command is allowed and `git clean -fdx` is still denied.
- [ ] Given `destructiveCommands: "warn"`, then the command is allowed and the warning is printed and recorded.
- [ ] Given an agent Edit to `.coding-flow/harness.json`, then it stays refused (existing blocked path), so the agent cannot allow itself.

## Edge Cases

- `git checkout -b new` / `git switch -c new` in the primary checkout still
  changes its branch: denied when `primaryLocked`.
- `git checkout <file>` (restore a file) is not a branch change, but it
  discards changes: denied only when the file is modified.
- `rm -rf node_modules`/`dist`/`.next`: still `rm`; the alternative names
  `trash` (a project can allow them explicitly).
- Windows shells and PowerShell: out of scope.

## Out of Scope

- Commands run by validation scripts or fixers (they are the project's own,
  declared commands).

## Security

STRICT: this is an authorization decision at the tool boundary. Fails open
only on what it cannot read, and records it; never fails open on a parsed
destructive command. The policy file is outside the agent's reach.
