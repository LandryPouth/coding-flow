# Story 24-01 — A worktree is ready and leaves nothing

## User Value

Every worktree — driven or interactive — starts ready to run and leaves
nothing behind: dependencies installed where links break, declared env files
copied, servers it started stopped on remove, a land that waits for a clean
primary instead of failing, one command to land a whole epic from its
worktree, and branch names that follow the project's pattern. 20-02 made this
work for the driver; this story makes it the lifecycle for everyone and
closes the remaining worktree rows of both DOGFOODING logs.

## Requirements

- **Deps**: `worktree add` defaults to `install` when the toolchain refuses
  links (pnpm + Turbopack, or a scanner `EISDIR` recorded in the journal —
  bethl, 10 occurrences); `link` stays available by flag (bethl bilan P2).
- **Env files**: `worktree.copyFiles` (20-02) applies to every `add`; doctor
  warns when a listed file is missing in the primary.
- **Servers**: `ai-flow serve -- <cmd>` (or the project's dev script through
  it) records the pid in `.coding-flow/worktree-processes.json` inside the
  worktree; `worktree remove` and `land` stop those processes (SIGTERM, then
  SIGKILL after 10 s) and report them.
- **Land when clean**: `land --wait` waits (max `land.waitMinutes`, default
  30) for the primary checkout to be clean instead of refusing; driven runs
  use it.
- **Epic land**: `worktree land --epic <epic>` lands one epic worktree that
  holds all its stories (`branchPerEpic`), after verifying each story's proof
  is fresh.
- **Branch policy**: `config.json` `branch.pattern` (e.g.
  `fix/OPS-{n}-{slug}` on bethl, enforced by its hooks); place/add name
  branches from it; `autoland` matches chains by the registry, never by name
  shape.
- **Nested add** (coding-flow DOGFOODING 2026-10-16 *worktree add*):
  `worktreeDest` resolves from the primary checkout (`git rev-parse
  --git-common-dir`), never from the current worktree.
- **Placement default** (coding-flow DOGFOODING 2026-10-16 *worktree place /
  flow-run*): interactive `place` uses the current checkout unless the user
  asked for a worktree or another story's lock is live there (20-02's busy
  rule); a done sibling in the tree never triggers a worktree.
- **Windows EBUSY** (coding-flow DOGFOODING 2026-10-16 *worktree autoland
  (Windows)*): remove retries the directory deletion with backoff up to 10 s
  and reports a leftover directory instead of failing the land; the 4 skipped
  win32 autoland tests are re-enabled.

## Acceptance Criteria

- [ ] Given a pnpm + Turbopack fixture, when `worktree add` runs without a
      deps flag, then dependencies are installed, not linked.
- [ ] Given a server started with `ai-flow serve` in a worktree, when the
      worktree is removed, then the process is stopped and reported.
- [ ] Given a dirty primary, when `land --wait` runs and the primary becomes
      clean within the wait, then the land completes.
- [ ] Given an epic worktree with all stories proven, when `land --epic`
      runs, then it merges once; given a stale proof, it refuses and names
      the story.
- [ ] Given `branch.pattern`, then new branches follow it and autoland still
      finds the chain.
- [ ] Given `worktree add --from <branch>` run inside another worktree, then
      the new worktree is created beside the primary, not nested.
- [ ] Given a chain whose sibling is done and no live lock, when interactive
      `place` runs, then it uses the current checkout.
- [ ] Given the win32 autoland tests, then they run (not skipped) and pass
      with the retry.

## Edge Cases

- A process that ignores SIGTERM: SIGKILL after 10 s, reported.
- `ai-flow serve` not used: nothing is tracked; remove says so once.

## Out of Scope

- Merge queue (24-02).

## Security

- **Killing processes**: only pids recorded by `ai-flow serve` in that
  worktree's file, only if their start time and cwd still match (pid reuse).
- **Deleting directories**: only registered worktrees, after the existing
  safety checks; never the primary.
- **Env files**: same rules as 20-02 (listed, ignored, inside the repo).
