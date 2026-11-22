---
name: flow-next
description: Rank the current project state into the one command worth running right now — a blocked story, a "done" claim with no captured verify behind it, stale proof, a proven story with unshipped work, or a planned story with no worktree yet. Read-only, no side effects, scoped to the checkout it runs from. Use when you don't know what to do next. Wraps `ai-flow next`.
---

# Next

## Overview

`status` describes; `next` decides. From the same proof-derived state as
`/flow-status`, it ranks one recommendation, highest priority first:

1. **blocked** — a story marked blocked: a human call, not a command.
2. **unproven** — the file claims `done`/`verified` with no captured green verify
   (or the last one failed). A written status is not proof, and never reaches
   `ready-to-ship` on its own.
3. **stale** — a captured green verify, but the code changed since.
4. **ready-to-ship** — proven, with unshipped work (commits or a dirty tree) on its
   branch or worktree.
5. **planned** — nothing started, no worktree.

## Command

```bash
ai-flow next
```

> If bare `ai-flow` is not on `PATH`, use `npx @landry_pouth/coding-flow next`.

`--all` prints the whole ranked queue; `--json` is machine-readable.

## Behavior

- Read-only: it never verifies, commits, ships or creates a worktree — it names the
  command that would.
- Scoped to the checkout it runs from, like `git status`: with several worktrees
  open, each answers for itself. Run it again after switching.

## Verification

- [ ] `ai-flow next` ran: the recommendation is its output, not your reading of the
      project.
- [ ] The tier and the reason it ranked there were reported, not only the command.
- [ ] The recommended command was **not** run without asking first.

## Output

The top recommendation (or the queue with `--all`): what it is, why it ranked there,
and the exact command to run. Ask before running it yourself — `next` recommends, it
does not act.
