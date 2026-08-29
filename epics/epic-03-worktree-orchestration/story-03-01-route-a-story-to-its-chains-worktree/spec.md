# Story 03-01 — Route a story to its chain's worktree

## User Value

Running `/flow-run` on any story of a multi-story epic puts the work in the
right place automatically — continuing an existing parallel chain where it
already lives, or opening a new worktree only when the story genuinely starts
a new parallel branch — so nobody has to read the epic's dependency tree by
hand before every invocation, or guess.

## Requirements

- Before doing any story work, `/flow-run` determines the story's chain in
  the epic's declared backbone/dependency tree (`index.md`).
- If the story's chain already has a location on record (from a prior
  invocation), the story runs there — no new worktree.
- If the story starts a chain that has no recorded location yet, and running
  it where the requesting checkout currently sits would collide with a chain
  already occupying that location, a new worktree is created via the
  existing `ai-flow worktree add --story <dir>` and recorded as that chain's
  location.
- If the story starts a chain and nothing else is currently occupying the
  requesting location (first story of the epic, or a plain/linear backbone
  with no parallel branches), it runs in place — no worktree is created.
- The placement decision is persisted somewhere readable from any of the
  epic's worktrees (not inside a single worktree's own `.coding-flow/`), so a
  later invocation — from any checkout, in a later session — reads the same
  decision instead of re-deriving it.
- A backbone with no dependency tree, or a tree with no parallel edges (a
  straight chain, however it is drawn), never triggers a worktree: every
  story in it shares the same one location.

## Acceptance Criteria

- [x] Given an epic with two parallel chains declared in its dependency tree
      (siblings with no edge between them), when the root story of the first
      chain runs via `/flow-run`, then it runs in the current checkout with
      no worktree created.
- [x] Given that same epic, when the root story of the second, sibling chain
      runs next, then a new worktree is created for it (`ai-flow worktree
      add --story <dir>`) and the current checkout is left untouched.
- [x] Given a story that is not the root of its chain (a dependent, e.g. the
      second story of a two-story chain), when it runs via `/flow-run`, then
      it runs in the same location already recorded for that chain — no new
      worktree, no placement in the wrong location.
- [x] Given an epic whose backbone declares a plain, strictly sequential
      chain (no dependency tree, or a tree with no parallel edges), when any
      of its stories run, then none of them ever gets a worktree — all run
      in the same single location.
- [x] Given a placement already recorded for a chain, when `/flow-run` is
      invoked again for another story of that chain from a different
      terminal/session, then it reads the same recorded location rather than
      re-deriving or guessing it.
- [x] Given an epic with no Backbone dependency tree at all (a single-story
      epic, or one with no `## Stories` beyond one), when its one story
      runs, then placement resolves to "run in place" with no error and no
      worktree.

## Edge Cases

- **Correctness**: a story referenced by the dependency tree but missing
  from `## Stories` (or vice versa) — placement must fail loudly rather than
  guess a location.
- **Concurrency**: two `/flow-run` invocations for two different chains
  started at nearly the same time — the placement state write must not let
  one silently overwrite the other's recorded location (last-writer-wins on
  unrelated chains is acceptable; corrupting an already-recorded chain's
  location is not).
- **Data**: a backbone dependency tree with a real edge that turns out to be
  wrong (two "parallel" stories that actually touch the same files) is
  explicitly not this story's problem to detect — `worktree land`'s existing
  conflict-stop already catches it downstream; this story only routes, it
  does not validate parallel-safety.
- **UX**: when a new worktree is created automatically, the user/agent
  driving `/flow-run` is told where it was created and why (which chain,
  which sibling it runs parallel to) — not a silent `cd`.

## Out of Scope

- Auto-landing a finished chain — story-03-02.
- Reconciling worktrees that already exist outside this system's bookkeeping
  (already-diverged epics like bethl's epic-18/19 today) — explicitly
  deferred, see epic `index.md` Decisions.
- Validating that a declared parallel edge is actually file-disjoint —
  `flow-plan`'s own authoring check, and `worktree land`'s conflict-stop,
  already cover this from two other angles.
