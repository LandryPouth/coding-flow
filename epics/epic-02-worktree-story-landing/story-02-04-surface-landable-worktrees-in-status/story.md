# Story 02-04 — Surface landable worktrees in status

**Execution mode**: FAST — read-only reporting, reuses existing collectors,
no new state.

## User value

Running `ai-flow status` with several stories in flight across worktrees
shows, per story, whether it's still active (locked, work in progress) or
landable (clean, verified, ready for `ai-flow worktree land`) — instead of
having to `cd` into each worktree and check by hand.

## Requirements

- In `bin/lib/status.js`'s `buildStatusModel` (`:69-98`), for each story that
  already has a linked `worktree` (via the existing `wt.byBranch` lookup),
  add a `landReady` field with one of: `"active"` (a
  `.coding-flow/active-story.json` lock is present in that worktree, from
  `story-02-01`), `"landable"` (no lock, worktree clean, a green non-stale
  verify is recorded for the story — same checks `story-02-02`'s `land`
  itself runs as preconditions), or `"unverified"` (no lock, but not yet
  clean+green — nothing actionable yet).
- Reuse existing collectors, do not re-derive: `collectWorktrees` from
  `bin/lib/worktree.js` (already imported by `status.js` as
  `buildWorktreeIndex`'s source), `latestVerifyByStoryDir` from `audit.js`
  (already used elsewhere, e.g. `ship.js`), and whatever dirty-check
  `story-02-02` ends up exposing (`realDirtyLines` or equivalent) rather than
  shelling out to `git status` a second way.
- Text output: append the `landReady` label next to the existing `→ wt:
  <path>` suffix on a story's line, only when a worktree is linked (no
  change to stories without one).
- JSON output (`status({ json: true })`): include `landReady` on each
  story's object alongside its existing `worktree` field.

## Acceptance criteria

- [ ] Given a story whose linked worktree has an active lock, when `ai-flow
      status` runs, then that story's line/JSON shows `landReady: "active"`.
- [ ] Given a story whose linked worktree is clean with a green, non-stale
      verify recorded, when `ai-flow status` runs, then it shows `landReady:
      "landable"`.
- [ ] Given a story whose linked worktree is dirty or has no green verify
      yet (and no lock), when `ai-flow status` runs, then it shows
      `landReady: "unverified"`.
- [ ] Given a story with no linked worktree at all, when `ai-flow status`
      runs, then no `landReady` field is added and existing output is
      unchanged.
- [ ] Given `ai-flow status --json`, when parsed, then every story object
      with a `worktree` also has a `landReady` string field.

## Commands

```
npm test
```

## Result

_(filled by /flow-run — include Rollback Notes)_

### Rollback Notes
