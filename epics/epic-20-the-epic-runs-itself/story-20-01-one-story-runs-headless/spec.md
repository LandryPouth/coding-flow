# Story 20-01 — One story runs headless

## User Value

`ai-flow run --driver claude --story <dir>` implements one prepared story with
no one watching: it checks the machine is safe to run unattended, places and
locks the story, launches one fresh `claude -p` process on
`/coding-flow:flow-run <story>` in driven mode, lets the CLI run `verify`
afterwards, and writes a run report with the cost. It is the walking skeleton
of the factory engine designed on 2026-11-10 and set aside
(`docs/research/research_notes/Usines à code IA/session_abandonnee_autonomie.md`).

## Requirements

- `RUN_DRIVERS` gains `claude`. `--driver claude` requires `--story` in this
  story (`--epic` is 20-06).
- **Preflight** (refuses the run, prints every failed check):
  - `claude` on PATH and its version recorded;
  - a headless guard self-test on this machine: a throwaway repo with the
    project's guard wiring, `claude -p` asked to write `.env` with the same
    permission flags the run uses; the denial must be observed (in
    `denials.jsonl` or the JSON result's permission denials). Cached per
    `claude` version + guard fingerprint for 24 h;
  - harness strictness as required by the project (`mode: strict` or the
    documented equivalent);
  - validation commands come from `config.json` (plan.md commands are refused
    unattended — story 10-02);
  - `run.budgetUsd.story` and `run.maxTurns.story` set in `config.json` (no
    default spend);
  - the story directory exists and its epic is not `not ready`.
- **Placement**: `worktree place` then `lock` exactly as `/flow-run` does
  (20-02 hardens it).
- **Invocation** (flags verified against the installed version inside this
  story; any difference is a stop condition, recorded in `## Decisions`):
  `claude -p "/coding-flow:flow-run <story>" --permission-mode dontAsk
  --allowedTools <from config, default: Read,Edit,Write,Glob,Grep,Bash>
  --max-turns <N> --max-budget-usd <X> --output-format json`, run with cwd =
  the story's worktree and env `AI_FLOW_DRIVEN=<runId>`, `AI_FLOW_STORY=<dir>`,
  `AI_FLOW_BASE=<diff base>`. Never `--bare` (it skips hooks, i.e. the
  guard). Nested-session env (`CLAUDECODE`) handled as `init` already does.
- **Driven-mode contract** in `/flow-run` (a short `## Driven mode` section):
  implement, run narrow tests, write `## Result` and traceability; do not run
  `verify`, do not write `## Status`, do not review yourself, never ask —
  write `## Needs you` and stop. The guard refuses a `## Status:` line written
  while `AI_FLOW_DRIVEN` is set.
- After the process exits: the CLI runs `verify --story` (19-03 queue
  applies), records the result, and writes `.coding-flow/runs/<ts>-run.json`
  with: run id, story, driver, claude version, session id, exit subtype
  (`success`, `error_max_turns`, `error_max_budget_usd`, …), num turns,
  `total_cost_usd`, permission denials, wall time, verify verdict.
- Events: `run.start`, `run.story.start`, `run.agent.end`, `run.end`.
- The story is left `in-progress` or `blocked`; `done` comes in 20-04.

## Acceptance Criteria

- [ ] Given a machine where the headless self-test cannot observe the guard
      denying `.env`, when `run --driver claude` starts, then it refuses and
      names the failed check.
- [ ] Given budget or turn caps missing from `config.json`, then the run is
      refused before any agent process starts.
- [ ] Given a prepared QUICK story in a fixture repo and a stub `claude`
      binary (test), when the run executes, then the stub receives `-p`,
      `/coding-flow:flow-run <story>`, `--permission-mode dontAsk`,
      `--max-turns`, `--max-budget-usd`, `--output-format json`, no `--bare`,
      and the env markers; then the CLI runs verify and the run report holds
      cost, session id and verdict.
- [ ] Given a driven agent writing `## Status: done`, then the guard denies it.
- [ ] Given `/flow-run`, then it has a `## Driven mode` section, stays under
      500 lines, and skill evals stay green.
- [ ] Given one real run on a throwaway story in this repository (manual,
      recorded in `## Result`), then the run report shows a real cost and a
      CLI-run verify.

## Edge Cases

- `claude` exits non-zero or prints non-JSON: recorded as `agent-error`, the
  CLI still runs verify (the tree may hold partial work) and the story is
  `blocked`.
- Behaviour of a guard deny under `bypassPermissions` is undocumented: the run
  never uses `bypassPermissions`; the self-test proves the mode it does use.
- Since Claude Code 2.1.302, `-p` without a mode starts in Manual and denies
  anything needing approval — always pass the mode explicitly.

## Out of Scope

- Retries (20-03), review (20-04), ownership/readiness (20-05), epics (20-06).

## Security

- **Who acts**: an agent with no human watching, in the story's worktree,
  with only the allowed tools; the guard (self-tested) blocks secrets and
  protected paths; 19-07 protects tests.
- **Hostile input**: the story text is the prompt. Only stories in the local
  checkout run (no issue bodies, no remote text); plan.md commands are never
  executed unattended.
- **Leak**: the run report holds no transcript, only ids, counts and cost.
- **Proof**: the self-test result and the CLI verify, both in the run report.
