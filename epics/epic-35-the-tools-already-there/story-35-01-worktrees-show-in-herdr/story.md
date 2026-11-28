# Story 35-01 — Worktrees show in Herdr

## Status: done

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

- [x] Given `HERDR_ENV=1` and a `herdr` binary, when `ai-flow worktree add`
      creates a worktree, then `herdr worktree open --cwd <repo> --path <worktree>
      --label <story-NN-NN or name> --no-focus` is called and the workspace id is
      printed.
- [x] Given a worktree open in Herdr, when `ai-flow worktree remove` (or `land`)
      removes it, then its workspace is closed before the directory goes.
- [x] Given that workspace runs an agent, or the command runs from it, when the
      worktree is removed, then the workspace is left open and the reason printed
      on stderr.
- [x] Given no `HERDR_ENV=1`, `AI_FLOW_HERDR=0`, a missing binary, a failing or
      garbled `herdr`, when any worktree command runs, then herdr is not called
      or its failure is ignored, and the command behaves as before.
- [x] Given `npm test` runs from a Herdr pane, when fixtures create worktrees,
      then no real Herdr is reached (`HERDR_*` stripped by the test env guard).

## Commands

```bash
npm test
```

## Result

`bin/lib/herdr.js` (no dependency) wraps three best-effort `herdr` calls, each
with a 5 s timeout and any failure read as "nothing to do":
`worktree open --cwd <repo> --path <wt> --label <story-NN-NN> --no-focus` after
`worktreeAdd` (so `add` and `place`), and `worktree list` → `pane list` →
`workspace close <id>` in `releaseWorktree`, called by `worktreeRemove` and
`landCleanup` before git removes the directory. The close is skipped when a pane
of that workspace runs an agent or `HERDR_WORKSPACE_ID` is that workspace — the
agent landing its own story must not be killed. Active only with `HERDR_ENV=1`;
`AI_FLOW_HERDR=0` opts out; `HERDR_BIN_PATH` is honoured. The close line goes to
stderr so `autoland --json` keeps stdout clean. `scripts/test-env-guard.js` strips
`HERDR_*`, so the suite never reaches a real Herdr; `test/herdr.test.js` drives a
fake binary, including through the CLI (`worktree add` then `remove`).

Verify: green, `Coverage: verified` (100% of 110 added lines). A first verify was
NOT PROVEN on `functionSize.enforce` (`worktreeAdd` 79→83, `landCleanup`
104→106): the Herdr calls moved into `showInHerdr` and `releaseWorktree`, which
also absorbs `removeManagedLinks`; both functions are back to their size.

Checked by hand on 2026-11-28: the 10 worktrees open across binah-shelf,
coding-flow and ai-learn opened in the sidebar with the same command. A Herdr
workspace rooted above the repository (a parent folder) is not recognised as its
source: Herdr then creates a repo-rooted one to group the worktrees under.

### Rollback Notes

`git revert` of the story's commits; nothing persisted. Without reverting,
`AI_FLOW_HERDR=0` turns the integration off.
