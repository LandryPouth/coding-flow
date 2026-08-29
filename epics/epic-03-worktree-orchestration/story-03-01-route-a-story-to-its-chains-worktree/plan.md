# Story 03-01 — Plan

## Implementation Context

- **Execution mode**: STRICT.
- **Scout pre-step**: yes — this story introduces a new parsing/decision
  layer with no existing equivalent; worth a short read of
  `bin/lib/worktree.js`, `bin/lib/next.js`, `bin/lib/status.js`, and one real
  epic `index.md` with a dependency tree
  (`epics/epic-02-worktree-story-landing/index.md` in this repo) before
  writing code.
- **Likely files**:
  - New: a small parser module for the Backbone dependency-tree section
    (e.g. `bin/lib/backbone.js`) — pure function, no I/O, mirroring
    `worktree.js`'s `parseWorktreesFrom` pattern (parse first, test the
    parser directly, wire it in after).
  - New: placement-state read/write, likely alongside `bin/lib/worktree.js`
    or its own small module — see storage location note below.
  - `bin/lib/worktree.js` — reuse `worktreeAdd`/`resolveStory`/
    `collectWorktrees` as-is; do not change their contracts.
  - Wherever `/flow-run` currently starts (`skills/flow-run/SKILL.md`,
    `templates/.claude/skills/flow-run/SKILL.md`) — the skill needs a
    placement step before any story work begins, and its own contract
    updated to describe it (mirrors how story-02-01 wired the lock into
    every intensity).
  - `bin/lib/next.js` — its tier-5 "planned, no worktree" suggestion
    currently prints `worktree add --story <dir>` unconditionally; once
    placement is decided elsewhere, decide whether `next` should stop
    suggesting a worktree for a story `/flow-run` would place automatically
    anyway, or leave `next` as the manual fallback for someone not going
    through `/flow-run`. Judgment call for the implementer; state the choice
    in `## Result`.
- **Search anchors**: `s1 ── s2` / ASCII box-drawing tree in `docs/plans/*.md`
  or existing epic `index.md` files; `resolveStory` in `worktree.js`
  (worktree naming = story dir basename, already deterministic — reuse,
  don't reinvent); `worktree.js`'s own comment on `active-story.json` being
  deliberately per-checkout (the reason placement state cannot live there).
- **Areas to avoid**: `worktree land`'s merge/rebase/rollback internals — out
  of scope, do not touch.

## Technical Notes

- **Storage location for placement state**: must be readable from any of the
  epic's worktrees, which each get their own working directory and their own
  `.coding-flow/` once created (`worktree add` does not share it). `git
  rev-parse --git-common-dir` returns the one location every worktree of a
  repository shares regardless of which checkout you run it from — resolve
  the concrete path/format there (e.g. under
  `<git-common-dir>/coding-flow/worktree-plan/<epic-name>.json`), not under
  any individual worktree's own `.coding-flow/`.
- **Dependency-tree parsing**: the format is the ASCII art `flow-plan`'s own
  contract already produces (`s1 ── s2`, or a branching tree using
  `├──`/`└──`/`┴──`). Parse conservatively: two stories are the same chain
  only when a real edge connects them; anything the parser cannot
  confidently read should fail loudly (per the spec's correctness edge case)
  rather than guess a placement.
- **Placement decision, precisely**: for a requested story, walk its chain
  back to the chain's root. If that root already has a recorded location,
  use it. Otherwise: if the location the invocation is currently running
  from is unoccupied by any other chain, use it (no worktree). If it is
  occupied by a different chain, create a new worktree via the existing
  `ai-flow worktree add --story <dir>` (named after the *story*, unchanged
  from today — only the epic-level `branchPerEpic` reminder text is wrong,
  not the worktree-naming convention itself, see story-03-03) and record it
  as this chain's location.

## Decisions

- Worktree naming stays per-story (`worktreeDest`/`resolveStory` unchanged)
  even though the branch *policy* is per-epic — a worktree is still created
  once per parallel chain in practice (a chain's later stories reuse the
  first story's worktree), so in the common case one worktree ends up
  serving the whole chain, which is what `branchPerEpic` actually wants;
  story-03-03 only fixes the reminder text's example, not the naming
  mechanism.
- Placement state format and exact file layout are an implementation detail,
  not specified further here — the constraint that matters (shared across
  worktrees, not per-checkout) is fixed above; the concrete schema is the
  implementer's call, documented in `## Result`.

## Test Plan

- Unit tests for the backbone/dependency-tree parser: a two-chain sibling
  epic, a single strict chain (with and without a dependency tree present),
  a chain with a consolidating story (`──┴──`), and a malformed/ambiguous
  tree (must fail loudly, not guess).
- Integration-style tests (matching `worktree.test.js`'s existing pattern of
  real temp git repos) covering the acceptance criteria directly: root of
  chain A runs in place, root of sibling chain B gets a new worktree, a
  dependent story of chain A reuses chain A's location, a second
  `/flow-run`-equivalent invocation from a fresh process re-reads the same
  recorded placement.

## Acceptance Traceability

| Criterion | Test |
|---|---|
| Chain A root runs in place | `test/backbone.test.js` / `test/worktree.test.js` — placement, no-worktree case |
| Chain B root gets a new worktree | same file — placement, new-worktree case |
| Chain A dependent reuses chain A's location | same file — placement, reuse case |
| Plain/linear chain never gets a worktree | same file — no-parallel-edges case |
| Placement persists across invocations | same file — re-read from a fresh process |
| No dependency tree at all resolves to "run in place" | same file — missing-tree case |

## Commands

```bash
npm test
```
