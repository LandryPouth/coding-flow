# Story 20-02 — The run owns its worktree

## User Value

A driven run never lands in a checkout someone else is working in, finds a
worktree ready to run (dependencies installed, declared env files present),
and lands its chain from the placement registry, not from wherever the
command happened to be called. On bethl, `place` chose the shared main
checkout for epic 39 while another session had uncommitted work there, and
autoland later refused because the chain was recorded at the primary.

## Requirements

- **Session-aware placement**: a checkout is busy if it has a live lock
  (pid + heartbeat, refreshed by the driver every 60 s) or uncommitted changes
  not belonging to the story. A driven run never places into a busy checkout;
  with `branchPerEpic`, a driven epic always gets its own worktree.
- **Lock with liveness**: the story lock file records pid, host, start,
  heartbeat; a lock whose story is `done` on a clean tree is released with a
  notice (coding-flow DOGFOODING 2026-11-10 *worktree lock*); a lock with a
  dead pid and no heartbeat for 10 minutes is reported stale and taken over by
  the driver.
- **Ready worktree**: `worktree add` used by the driver installs dependencies
  (`--deps install`) when the project's toolchain refuses links (detected:
  pnpm/Turbopack, bethl `EISDIR`, 10 occurrences) and copies the env files
  listed in `config.json` (`worktree.copyFiles`, e.g. `apps/api/.env`) —
  copied, never committed, and only files ignored by git.
- **Autoland from the registry**: `autoLandIfChainFinished` decides
  `not-isolated` from the placement registry (is there a worktree holding the
  chain?), not from the caller's directory (coding-flow DOGFOODING 2026-11-10
  *worktree autoland*); from the primary with an isolated chain, it lands it.
- **Fork point**: a worktree's `codingFlowBase` is a branch name; a SHA
  recorded on the base branch itself is ignored with a warning (coding-flow
  DOGFOODING 2026-11-10 *verify (proof scope)*).

## Acceptance Criteria

- [ ] Given a primary checkout with another story's uncommitted files, when a
      driven run places a story, then it opens a worktree and never uses the
      primary.
- [ ] Given a lock whose story is `done` on a clean tree, when lock is
      requested for another story, then the old lock is released with a
      notice.
- [ ] Given `worktree.copyFiles` listing an ignored `.env`, when the driver
      creates the worktree, then the file is present in it and still ignored.
- [ ] Given a listed file that git tracks, then it is refused (never copy a
      tracked file over).
- [ ] Given an isolated finished chain and `autoland` called from the primary,
      then it lands the chain instead of answering `not-isolated`.
- [ ] Given `branch.develop.codingFlowBase` set to a SHA, when verify resolves
      the diff base on `develop`, then it ignores it and warns.

## Edge Cases

- Heartbeat on a sleeping laptop: stale only after 10 minutes without pid.
- A `.env` missing in the primary: the run continues, the report names it.

## Out of Scope

- Stopping dev servers and land-when-clean (24-01).

## Security

- Copying env files: only paths listed in `config.json`, only git-ignored
  files, only inside the repo; never printed; the copy is logged by name.
- Taking over a lock: only when the pid is dead and the heartbeat stale.
