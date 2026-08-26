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

- [x] Given a story whose linked worktree has an active lock, when `ai-flow
      status` runs, then that story's line/JSON shows `landReady: "active"`.
- [x] Given a story whose linked worktree is clean with a green, non-stale
      verify recorded, when `ai-flow status` runs, then it shows `landReady:
      "landable"`.
- [x] Given a story whose linked worktree is dirty or has no green verify
      yet (and no lock), when `ai-flow status` runs, then it shows
      `landReady: "unverified"`.
- [x] Given a story with no linked worktree at all, when `ai-flow status`
      runs, then no `landReady` field is added and existing output is
      unchanged.
- [x] Given `ai-flow status --json`, when parsed, then every story object
      with a `worktree` also has a `landReady` string field.

## Commands

```
npm test
```

## Status: done

## Result

`buildStatusModel` in `bin/lib/status.js` now computes a `landReady` field
for every story with a linked worktree, reusing existing collectors instead
of re-deriving state:

- `.coding-flow/active-story.json` existence check (in the worktree, from
  `story-02-01`, not yet writing it — the check is forward-compatible) →
  `"active"`.
- `realDirtyLines` (now exported from `bin/lib/worktree.js`) against the
  worktree's absolute path → dirty means `"unverified"`.
- `latestVerifyByStoryDir` + `isStale` (now exported from `bin/lib/audit.js`)
  against the worktree's own `.coding-flow/runs` (verify evidence lives
  per-worktree, not in the calling `cwd`) and `currentTreeToken` computed on
  that same worktree path → green and fresh means `"landable"`, otherwise
  `"unverified"`.

`buildWorktreeIndex` was extended to keep each worktree's absolute path
alongside the existing portable display path, since the lock/dirty/verify
checks all need to read inside that worktree, not the status-invoking `cwd`.

Text output appends `[landReady]` next to the existing `→ wt: <path>`
suffix; JSON output includes `landReady` on the story object, only when a
worktree is linked — stories without one are unchanged.

Commands:
- `npm test` → 474 passed (467 pre-existing + 7 new in
  `test/status-land-ready.test.js`).
- `ai-flow verify --story <this story dir>` → green;
  `Coverage: not-required` (risk scored low — no story or diff terms
  matched a high-risk pattern), consistent with the story's own FAST
  intensity.

### Rollback Notes

A `git revert` of this story's own commit is sufficient: no schema, no
config, no feature flag. `realDirtyLines` and `isStale` were only added to
their modules' existing `module.exports` (no behavior change to either
module); reverting this story's `landReady`/`computeLandReady`/
`buildWorktreeIndex` changes in `status.js` alone fully restores prior
behavior — this does **not** cover any other change that happens to touch
`status.js` in the same working tree (e.g. `untrackedPlans`), which belongs
to its own commit and its own rollback.
