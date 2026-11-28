# Story 35-01 — Worktrees show in Herdr

## Status: in-progress

## User Value

Inside Herdr, every worktree `ai-flow` creates appears in the sidebar under its
story number, and disappears when the worktree is removed or landed — without
Coding Flow depending on Herdr.

## Implementation Context

- Observed 2026-11-28: `herdr worktree list --cwd <repo>` sees the worktrees
  (it reads git), but the sidebar shows workspaces and a plain
  `git worktree add` opens none; 10 worktrees across three repos were invisible.
  The bare-repo layout ("Git worktree like a boss", Metal3d) was ruled out: same
  shared store, fetch, hooks and branch lock, and it opens no workspace either.
- Likely files: new `bin/lib/herdr.js`; `bin/lib/worktree.js` (`worktreeAdd`,
  `worktreeRemove`, `landCleanup`); `scripts/test-env-guard.js`;
  `test/herdr.test.js`; `test/layering.test.js`.
- Execution mode STANDARD. Scout: no. Avoid: any change to the layout, to
  `place`'s output, or to stdout under `--json`.

## Acceptance Criteria

- [ ] Given `HERDR_ENV=1` and a `herdr` binary, when `ai-flow worktree add`
      creates a worktree, then `herdr worktree open --cwd <repo> --path <worktree>
      --label <story-NN-NN or name> --no-focus` is called and the workspace id is
      printed.
- [ ] Given a worktree open in Herdr, when `ai-flow worktree remove` (or `land`)
      removes it, then its workspace is closed before the directory goes.
- [ ] Given that workspace runs an agent, or the command runs from it, when the
      worktree is removed, then the workspace is left open and the reason printed
      on stderr.
- [ ] Given no `HERDR_ENV=1`, `AI_FLOW_HERDR=0`, a missing binary, a failing or
      garbled `herdr`, when any worktree command runs, then herdr is not called
      or its failure is ignored, and the command behaves as before.
- [ ] Given `npm test` runs from a Herdr pane, when fixtures create worktrees,
      then no real Herdr is reached (`HERDR_*` stripped by the test env guard).

## Commands

```bash
npm test
```

## Result
