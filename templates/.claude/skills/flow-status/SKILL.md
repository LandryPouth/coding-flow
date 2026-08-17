---
name: flow-status
description: Show where every epic and story actually stands — proof-derived state (verified / stale / blocked / planned), the worktree linked to each story, and the branch policy reminder. Read-only, no side effects. Use any time you want to know the state of the project without leaving Claude Code, not just after running a workflow skill. Wraps `ai-flow status`.
---

# Status

## Overview

`status` reports the state of every epic and story, derived from captured evidence
rather than trusted prose: an explicit `## Status` line in a story file wins when
present, otherwise the latest `verify` decides (green → `verified`, red →
`blocked`, code changed since that run → `stale`), and only then a fallback
heuristic. It also shows which worktree (if any) each story is checked out in, and
reminds you when you are on the base branch under a `branchPerEpic` policy.

This is not a workflow stage — run it any time, as often as you like.

## Command

```bash
ai-flow status
```

> If bare `ai-flow` is not on `PATH`, use `npx @landry_pouth/coding-flow status`.

Useful flags:

- `--json` — machine-readable output (epics, worktrees, policy).

## Behavior

- Read-only: never writes, verifies, commits, or pushes anything.
- `verified` means the machine actually ran the story's validation commands and
  they passed, and that proof still matches the current code. A story that reads
  `## Status: done` in its file but has no captured green verify does not show as
  `verified` here — see `/flow-next` if you want that gap turned into an action.
- Loose worktrees (checked out but not linked to any story) are listed separately,
  useful when several features are in flight in parallel.

## Output

Report the epics and their stories with each status, any worktree link, loose
worktrees, and the policy reminder if you are on the base branch. Do not summarize
away individual story names — the point of this skill is the detail.
