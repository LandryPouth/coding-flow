# Story 03-02 — Auto-land a finished chain

## User Value

Once a chain's last story is proven — done, with a green, non-stale verify,
and nothing left of that chain unstarted — its worktree merges onto the epic
branch and cleans up after itself, without anyone having to notice it is
ready and type `ai-flow worktree land` by hand.

## Requirements

- After a story reaches the `verified` state (the same derived state
  `status.js`/`next.js` already compute: an authored `## Status: done` plus a
  matching green, non-stale verify), check whether it was the last
  not-yet-done story of its chain.
- If it was the chain's last story and that chain is running in its own
  worktree (not the primary checkout), automatically run the existing
  `ai-flow worktree land` for it.
- On a successful land, remove the worktree directory as `land` already
  does, and additionally remove the parent `<repo>-worktrees/` directory if
  no other worktree remains inside it.
- On a failed land (conflict, or a failed post-land re-verify — both already
  handled by epic-02's `land`), report exactly what `land` reports today;
  nothing is landed silently, nothing new is invented on the failure path.
- If the chain's last story finishes but its chain was running in the
  primary checkout (no worktree — e.g. the sole chain of a linear epic),
  there is nothing to land or clean up; this is a no-op, not an error.
- The placement state recorded in story-03-01 is cleared for that chain once
  it lands, so a later story that happens to reuse the same chain slot
  (should not normally occur, but must not silently reuse a stale,
  already-landed worktree path).

## Acceptance Criteria

- [x] Given a two-story chain running in its own worktree, when its second
      (last) story reaches the `verified` state, then `ai-flow worktree
      land` runs automatically and the worktree directory no longer exists
      afterward.
- [x] Given that same chain was the only worktree under `<repo>-worktrees/`,
      when it lands, then the now-empty `<repo>-worktrees/` directory is
      also removed.
- [x] Given two chains still running in separate worktrees under
      `<repo>-worktrees/`, when one of them lands, then only its own
      worktree directory is removed and the sibling's worktree is untouched.
- [x] Given a chain's last story reaches `verified` but the post-land
      re-verify (epic-02's existing safety net) fails, when auto-land runs,
      then the merge is rolled back exactly as `worktree land` already does
      today, and the failure is reported — not silently retried or
      swallowed.
- [x] Given a story reaches `verified` but other stories of its chain are
      not yet done, when that happens, then no land is attempted.
- [x] Given a chain that was never isolated in its own worktree (ran in the
      primary checkout throughout), when its last story reaches `verified`,
      then nothing is landed or removed — there is no worktree to clean up.

## Edge Cases

- **Correctness**: a story marked `verified` out of order (e.g. a later
  story in the chain finishes before an earlier one, if that is even
  reachable) must not trigger a land while an earlier dependency of the same
  chain is still open.
- **Concurrency**: two chains reaching "last story verified" at nearly the
  same moment must not race on removing the shared `<repo>-worktrees/`
  parent directory (only remove it if it is actually empty at removal time,
  not based on a stale check).
- **Data**: a land that fails and rolls back must leave the story's own
  worktree, branch, and placement-state entry exactly as `worktree land`
  already guarantees today — this story adds no new failure surface, only
  the automatic trigger.
- **UX**: whoever triggered the story that completed the chain sees that a
  land happened automatically and its result (success, or the exact failure
  `land` reported) — not silence.

## Out of Scope

- Any change to what makes a land succeed or fail — epic-02's `ff-only`/
  rebase/re-verify/rollback contract is reused exactly as-is.
- Requiring a `/flow-review` pass before auto-land — explicitly deferred,
  see epic `index.md` Decisions.
- Reconciling already-existing, already-diverged worktrees from before this
  system existed.
