# Story 03-02 — Plan

## Implementation Context

- **Execution mode**: STRICT.
- **Scout pre-step**: no — builds directly on story-03-01's placement state
  and epic-02's existing `worktree land`; no new discovery needed beyond
  reading those two.
- **Likely files**:
  - `bin/lib/worktree.js` — call the existing `worktreeLand`/`landCleanup`
    functions (or the CLI entrypoint they back) as-is; add the
    `<repo>-worktrees/` parent-directory cleanup once a worktree is removed
    and the parent is empty (extend `landCleanup`, or wrap it —
    implementer's call).
  - Wherever story-03-01's placement decision and "verified" check happen
    (`skills/flow-run/SKILL.md`'s new placement step, or a small
    `bin/lib/*` module it calls) — this story adds a post-completion check:
    is this story its chain's last one, and is that chain in a worktree.
  - The placement-state module from story-03-01 — needs a "chain's last
    remaining story" query and a "clear this chain's recorded location"
    write.
- **Search anchors**: `landCleanup` in `worktree.js` (the exact sequence:
  unlock, remove managed links, `git worktree remove`, `git worktree prune`,
  delete branch — extend, do not restructure); `latestVerifyByStoryDir`/
  `isStale` in `audit.js` (the `verified` check `land` itself already
  performs before merging — reuse the same definition here for "is this
  story actually verified," don't redefine it).
- **Areas to avoid**: `worktree land`'s merge/rebase/conflict/re-verify
  internals (epic-02's contract, unchanged).

## Technical Notes

- "Chain's last not-yet-done story" is answered from the same dependency
  graph story-03-01 parses — no new graph logic here, only a query over it
  (does any other story on this chain have a status other than
  `done`/`verified`).
- The `<repo>-worktrees/` parent removal must check emptiness at the moment
  of removal (`fs.readdirSync` right before `fs.rmdir`), not rely on a count
  computed earlier in the same run, to avoid the race the spec's concurrency
  edge case describes.
- Auto-land reuses `worktree land`'s own preconditions (clean tree, green
  non-stale verify) unchanged — this story does not duplicate or re-check
  them; it only decides *when* to call the existing command, exactly like
  story-03-01 for `add`.

## Decisions

- Auto-land failure (conflict or failed re-verify) is reported the same way
  a manually-run `land` reports it today — no new failure-summary format
  invented for the automatic path, so there is exactly one way `land`
  failure ever looks, whoever or whatever triggered it.
- The parent `<repo>-worktrees/` directory is removed on empty, not
  proactively kept around "in case another story needs it soon" —
  `worktree add` already recreates it via
  `fs.mkdirSync(..., { recursive: true })` the next time it is needed, so
  nothing is lost by removing it early.

## Test Plan

- Extend `worktree.test.js`'s existing real-temp-git-repo pattern: a
  two-story chain in its own worktree reaching `verified` on its last story
  triggers land + directory removal; a sibling worktree untouched when only
  one of two chains lands; the empty-parent-directory removal, and the case
  where it is *not* removed because a sibling worktree remains; the
  rollback-on-failed-re-verify path leaves the worktree/branch/placement
  state untouched, matching epic-02's existing guarantee.

## Acceptance Traceability

| Criterion | Test |
|---|---|
| Last story of a worktree'd chain triggers land + directory removal | `test/worktree.test.js` — auto-land, single chain |
| Empty parent `<repo>-worktrees/` removed | same file — parent cleanup |
| Sibling worktree untouched when only one chain lands | same file — parent cleanup, non-empty case |
| Failed post-land re-verify rolls back, is reported | same file — auto-land, rollback case |
| Not-yet-done sibling in the same chain blocks the land | same file — no-op case |
| Chain never isolated in a worktree: no-op on completion | same file — no-op, primary-checkout case |

## Commands

```bash
npm test
```
