---
name: flow-status
description: Show where every epic and story actually stands — proof-derived state (verified / stale / blocked / planned), the worktree linked to each story, and the branch policy reminder. Read-only, no side effects. Use any time you want to know the state of the project without leaving Claude Code, not just after running a workflow skill. Wraps `ai-flow status`.
---

# Status

## Overview

`status` reports every epic and story from captured evidence, not prose: a
`## Status` line in the story wins when present; otherwise the latest `verify`
decides (green → `verified`, red → `blocked`, code changed since → `stale`); a
heuristic comes last. It also shows the worktree each story is checked out in, and a
reminder when you are on the base branch under a `branchPerEpic` policy. Read-only,
so run it as often as you like.

## Command

```bash
ai-flow status
```

> If bare `ai-flow` is not on `PATH`, use `npx @landry_pouth/coding-flow status`.

`--json` gives epics, worktrees and policy, machine-readable.

## Behavior

- `verified` means the story's validation commands ran green and that proof still
  matches the code. A story whose file reads `## Status: done` with no captured green
  verify is not `verified` — `/flow-next` turns that gap into an action.
- Worktrees linked to no story are listed separately.

## Verification

- [ ] `ai-flow status` ran: nothing is reported from memory or from reading story
      files by hand.
- [ ] Every story is listed by name with its state; none were summarized away.
- [ ] The branch policy reminder was relayed if the command printed one.

## Output

Every epic and its stories with their state and worktree link, the loose worktrees,
and the policy reminder if one was printed. Keep the individual story names — the
detail is the point.
