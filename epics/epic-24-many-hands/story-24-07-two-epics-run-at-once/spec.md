# Story 24-07 — Two epics run at once

## User Value

The maintainer starts a second `ai-flow run --epic` while the first is still
running, and the tool decides whether they can share the machine: an epic
that depends on the other, or that would touch the same migrations, waits
with a reason; otherwise both run inside the same two agent slots, and the
second to land is merged with the first, re-verified and reviewed where they
crossed — the case of bethl epics 37/38, run side by side by hand and found
colliding only by a review the user launched (bethl DOGFOODING 2026-11-12).

## Requirements

- **Active runs registry**: `<git-common-dir>/coding-flow/active-runs.json`
  (shared by every worktree of the repo), one entry per live run: run id,
  pid, epic, epic branch, worktrees, paths changed so far. Written under
  `withFileLock`; an entry whose pid is dead is dropped and reported.
- **Epic dependencies**: a `Depends on epics: <NN>[, <NN>]` line in the epic
  `index.md` (written by `/flow-plan`, checked by `doctor`). A run refuses to
  start an epic whose dependency is not landed on the base, and names it.
- **Overlap between epics**: the 24-02 check across epics — the new epic's
  stories' *Likely files* against each active run's declared files and
  changed paths. A shared `run.serialPaths` path → the new run waits
  (`run.wait`, reason and holder printed once a minute, `run.waitMinutes`
  default 0 = refuse at once); any other shared path → allowed, recorded for
  the crossing review at land.
- **Shared limits**: both runs draw from 24-02's machine-wide agent slots
  and 19-03's verify queue; two epics never make more than `run.maxAgents`
  agent processes or two concurrent heavy verifies.
- **Landing into the base, one epic at a time**: an epic that finishes
  enters a base queue. If the base moved since the epic forked, the queue
  merges the base into the epic branch in a scratch worktree, runs verify on
  the merged tree (all required tiers) and a crossing review on the files
  both epics changed; green and no open P0/P1 → the land proceeds (`land:
  local` merge or the 24-04 PR); red → the later epic is parked
  (`blocked (base merge)`), the earlier one is never undone.
- **Servers**: `ai-flow serve` (24-01) picks a free port from `serve.ports`
  and exports it to the command; it never starts on a port another
  worktree's recorded server holds, and says which.
- `ai-flow status` lists active runs, who holds each agent slot, and which
  epic waits on what.
- Events `run.wait`, `run.overlap`, `base.queue.enter`, `base.queue.merge`,
  `base.queue.park`.

## Acceptance Criteria

- [ ] Given epic B with `Depends on epics: A` and A not landed, when
      `run --epic B` starts, then it refuses and names A.
- [ ] Given a live run of epic A whose files include a `run.serialPaths`
      path that epic B also lists, when `run --epic B` starts, then it
      waits (or refuses with `waitMinutes: 0`) and names the path and A.
- [ ] Given two live runs, then the machine never holds more than
      `run.maxAgents` agent processes across both.
- [ ] Given A landed first and B touching a file A changed, when B lands,
      then the base is merged into B in a scratch worktree, verify runs on
      the merged tree and a crossing review covers that file.
- [ ] Given that merged tree red, then B is parked and the base and A are
      unchanged.
- [ ] Given a dead run's entry in the registry, then the next run drops it
      with a notice.

## Edge Cases

- Both epics' `Likely files` empty or stale: the check sees nothing; the
  base merge verify and crossing review are the net (same limit as 24-02).
- The same epic started twice: refused (the registry already holds it).
- A run of the same epic resumed (20-06) keeps its registry entry.
- A dev database shared by both runs: migrations are `serialPaths`, so two
  epics never change the schema at once; tests still share the data, and
  the 19-03 queue keeps their heavy verifies apart.

## Out of Scope

- Two machines (24-03 locks).
- More than two epics at once by default (`maxAgents` already caps them).
- Ordering epics automatically from the roadmap: the maintainer starts each
  run.

## Security

- Unattended merges only in scratch worktrees and epic branches; the base
  moves only through `land` (local) or a PR (24-04), never by a driven agent.
- The registry holds paths and pids, never env values.
