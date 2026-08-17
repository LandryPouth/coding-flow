---
name: flow-next
description: Rank the current project state into the one command worth running right now — a blocked story, a "done" claim with no captured verify behind it, stale proof, a proven story with unshipped work, or a planned story with no worktree yet. Read-only, no side effects, scoped to the checkout it runs from. Use when you don't know what to do next. Wraps `ai-flow next`.
---

# Next

## Overview

`status` describes state; `next` decides. It reads the exact same proof-derived
state as `/flow-status` and ranks it into a single recommendation, highest
priority first:

1. **blocked** — a story marked blocked. Needs a human call, not a command.
2. **unproven** — a story claims `done`/`verified` in its file but has no captured
   green verify (or the last one failed). A written status is not proof.
3. **stale** — a story has a captured green verify, but the code changed since.
4. **ready-to-ship** — a story is proven and has unshipped work (commits or a
   dirty tree) on its branch or worktree.
5. **planned** — a story has nothing started yet and no worktree.

This is not a workflow stage — run it any time you'd otherwise ask "what should I
do now?".

## Command

```bash
ai-flow next
```

> If bare `ai-flow` is not on `PATH`, use `npx @landry_pouth/coding-flow next`.

Useful flags:

- `--all` — print the whole ranked queue instead of just the top item.
- `--json` — machine-readable output.

## Behavior

- Read-only: never runs verify, commits, ships, or creates a worktree itself — it
  only tells you the command that would do that.
- Scoped to the checkout it runs from (like `git status`): with several worktrees
  or terminals open in parallel, each one's `next` answers for *that* checkout,
  not a global view across all of them. Run it again after switching worktrees.
- Proof-based like `/flow-ship`'s auto-merge gate: a story's own `## Status: done`
  text is not enough to reach tier 4 (`ready-to-ship`) — it needs an actual
  captured green verify first, otherwise it surfaces as tier 2 (`unproven`).

## Output

Report the top recommendation (or the full ranked queue with `--all`): what it is,
why it ranked there, and the exact command to run next. Ask before running that
command yourself — `next` recommends, it does not act.
