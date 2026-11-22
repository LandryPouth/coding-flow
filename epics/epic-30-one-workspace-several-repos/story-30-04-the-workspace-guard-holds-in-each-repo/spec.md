# Story 30-04 — The workspace guard holds in each repository

## User Value

An agent working in `web/` or in a `web-worktrees/…` folder is held by the
workspace's guard policy (protected `.env`, refused destructive commands,
`mode`), not by the default policy README "Nested projects" grants today to
a nested git repository with no `.coding-flow/`. One policy, written once,
everywhere the workspace's stories write.

## Requirements

- `guard.js` `projectRoots` (`:262`): when the workspace config declares
  repositories, a path inside a declared repository **or inside one of its
  story worktrees** (sibling `<repo>-worktrees/…`) resolves to the workspace
  policy.
- A declared repository's own `.coding-flow/` is not merged silently:
  `doctor` reports it as an error (decision of the epic); the guard keeps
  only the stricter rule when both exist (a nested policy only adds
  refusals, as today).
- Protected-path patterns are matched relative to each repository root too
  (`api/.env` and `.env` inside the `api` worktree are both `.env`).
- The guard stays fail-closed: a workspace config that cannot be read →
  today's strict fallback, never "allow".

## Acceptance Criteria

- [ ] Given a workspace protecting `.env` and a declared repository `web`, when a write to `web/.env` is attempted, then the guard refuses it naming the workspace policy.
- [ ] Given a story worktree `web-worktrees/story-30-04-x/` outside the workspace folder, when a write to its `.env` is attempted, then the guard refuses it.
- [ ] Given `git reset --hard` run with cwd in `api-worktrees/<branch>`, when the guard checks it, then it is refused as destructive (29-03 rule) under the workspace policy.
- [ ] Given a write to `web/src/a.ts`, when the guard checks it, then it is allowed.
- [ ] Given an unreadable workspace config, when a write in `web/` is checked, then the strict fallback applies.
- [ ] Given no `repos`, the existing guard suite is unchanged and green.

## Edge Cases

- Worktrees placed outside the workspace folder (siblings of each
  repository): matched by the recorded `<repo>-worktrees` path, never by name
  alone.
- WSL case-insensitive mounts (README guard limits): unchanged, documented.
