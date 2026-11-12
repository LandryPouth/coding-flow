# Story 24-03 — Locks are seen across machines

## User Value

A story locked on one machine is seen as locked on another: locks become git
refs pushed to the shared remote, so two people (or two runners) never
implement the same story, and a stale lock is shown with its age instead of
being broken silently.

## Requirements

- `locks: local | refs` in `config.json` (default `local`, unchanged).
- With `refs`: `worktree lock` creates `refs/coding-flow/locks/<story-slug>`
  pointing to a blob with holder (git user), host alias, pid, start,
  heartbeat; pushes it with `--force-with-lease` semantics (create only if
  absent on the remote); `unlock` deletes it locally and remotely.
- `status`, `next` and `place` fetch `refs/coding-flow/locks/*` (bounded
  timeout, offline tolerated with a warning) and show remote holders.
- Heartbeat: the driver updates the ref every 5 minutes; a lock older than
  `locks.staleMinutes` (default 60) without heartbeat is shown stale with its
  age; `worktree lock --take-over <story>` breaks it explicitly and records
  who did.

## Acceptance Criteria

- [ ] Given two clones of a bare fixture remote, when clone A locks a story,
      then clone B's `place` refuses it and names A's holder.
- [ ] Given a race (both lock at once), then exactly one succeeds.
- [ ] Given a stale lock, then status shows its age and place still refuses
      without `--take-over`.
- [ ] Given `--take-over`, then the lock moves and an event records it.
- [ ] Given the remote unreachable, then commands warn and fall back to local
      locks.

## Edge Cases

- Story slugs with characters invalid in refs: encoded.

## Out of Scope

- Locks on a server or service.

## Security

- **Integrity**: anyone with push rights can write the refs; locks are
  coordination, not authorization — documented as such.
- **Privacy**: host alias, not hostname; no paths.
- **Take-over**: explicit, recorded with the git user.
