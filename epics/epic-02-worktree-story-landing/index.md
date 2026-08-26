# Epic 02 — Worktree story landing

## Goal

Two stories of the same epic run in real parallel — different worktrees,
different agents — without corrupting each other's uncommitted state, and a
finished, verified story worktree has an actual path back onto the shared
epic branch. Today neither half exists: nothing stops a second `/flow-run`
from starting on a checkout that already carries another story's unfinished
work, and once a story *is* isolated in its own worktree, there is no command
that reconciles it back — `ai-flow worktree add`/`remove` create and destroy
worktrees, `ai-flow ship` pushes one branch and opens one PR, and nothing in
between merges one into the other.

## Why

Found by dogfooding, not invented: `docs/DOGFOODING.md` in
`~/dev/saas/bethl` (2026-08-22, two rows, both `high`, both `open`) records
that running `story-17-02` and `story-17-03` in parallel — exactly as
epic-17's own backbone declared safe (disjoint files) — mixed the two
stories' uncommitted diffs on one shared checkout. `/flow-review
story-17-03` reviewed code that belonged to the still-unstarted
`story-17-02`; the `verify` captured for `story-17-03` ran against a tree
that already contained that unrelated code, so its green result proved
nothing in isolation. A second row from the same day: files from an already-
landed `story-17-03` (a Prisma schema, its spec, a migration folder already
applied to the database) reverted on disk while a different story was being
shipped on the same tree.

## Freeze status

Not a freeze exception — `docs/design-decisions.md` entries 6 and 10 gate
*new* capabilities the tool did not previously claim. Parallel work via
worktrees is already a declared capability: `bin/lib/worktree.js`'s own
header says "Optional Git worktree support for **parallel work**," and
`skills/flow-plan/SKILL.md:97-99` already tells users to put parallel-safe
sibling stories in separate worktrees. This epic closes the gap between that
claim and what the tool actually does once you follow the instruction — the
same class of fix `docs/DOGFOODING.md` exists to surface, not a new feature
needing entry 6/10's "premise changed" test.

## Scope

**In scope**

- A lock that stops a second story from starting on a checkout that already
  carries another story's unfinished work — mechanical (is there unlanded
  work here right now), not dependent on parsing the epic backbone's ASCII
  tree (confirmed free text today, not machine-read by any lib — see
  Decisions).
- `ai-flow worktree land` — reconciles a finished, verified story worktree
  onto the branch it was run from: fast-forward when possible, a rebase
  replay when the target moved, a hard stop (never an auto-resolve) on a
  real conflict.
- A re-verify of the *merged* result, always, plus automatic rollback of the
  land if that re-verify fails — the backstop for two independently-green
  stories (the concrete worry: two Prisma migrations, no textual conflict,
  incompatible schemas) combining into something broken that no single
  story's isolated verify could have seen.
- `ai-flow status` surfaces which story worktrees are landable, landed, or
  still active, reusing the worktree/verify data it already collects.

**Out of scope**

- Any change to `ai-flow ship`'s push/PR/auto-merge logic. `land` only
  reconciles worktrees into the one epic branch `ship` already pushes;
  `ship` itself does not change.
- Parsing or validating the epic backbone's dependency tree. The lock this
  epic adds does not trust a story's declared parallel-safety — it is a
  purely mechanical "is this checkout already occupied" check, and stays
  correct even when a backbone edge is wrong.
- Automatic conflict resolution of any kind, textual or semantic. A real
  conflict — at rebase time or at post-land re-verify — always stops and
  reports; a human or agent resolves it in the story's own worktree.
- Multi-way land (reconciling more than one story worktree in a single
  operation). One `land` call, one story.

## Backbone

`Backbone: a second story starts → it's told the checkout is occupied →
isolates in its own worktree → finishes and lands back onto the epic branch
→ the merged result is proven, or the land undoes itself`

### Story dependency tree

```text
s1
└── s2
    ├── s3
    └── s4
```

`s1` is the walking skeleton: the lock alone is already useful without
`land` existing — hitting it today just means "isolate by hand," the same
instruction `flow-plan` already gives. `s2` adds `land`'s core mechanics
(ff-only, rebase-replay, conflict stop, cleanup) and depends on `s1`'s
lock/unlock primitive to clear on success. `s3` (post-land re-verify +
rollback) and `s4` (status surfacing) both build only on `s2`'s land
existing — they touch no shared files with each other (`s3`: `land`'s
success path plus `harness.js`'s validation-command runner; `s4`:
`status.js`'s reporting layer only) and are parallel-safe siblings once `s2`
is done — the exact shape this epic exists to make safe to actually run
that way.

## Stories

1. **story-02-01-lock-a-story-before-parallel-work** — a gitignored
   `.coding-flow/active-story.json`, written when a story starts and cleared
   when it finishes, refuses a second story on an occupied checkout, wired
   into `skills/flow-run/SKILL.md` for every intensity.
2. **story-02-02-land-a-story-onto-its-epic-branch** — `ai-flow worktree
   land <name>`: clean-tree and green-verify preconditions, ff-only merge,
   rebase-replay fallback, hard stop on conflict, worktree/branch cleanup.
3. **story-02-03-verify-and-roll-back-a-landed-story** — always re-run the
   project's validation commands against the merged epic branch after a
   land; on failure, `git reset --hard` the single merge commit `land` just
   created and report which check failed.
4. **story-02-04-surface-landable-worktrees-in-status** — `ai-flow status`
   lists each epic's story worktrees as active (locked), landable (clean +
   verified), or landed, reusing `collectWorktrees` and
   `latestVerifyByStoryDir` rather than new state.

## Decisions

- **The lock does not trust the backbone.** It only ever asks "is there
  unlanded work on this checkout right now" — never "does the plan say these
  two stories are parallel-safe." A missing or wrong edge in the backbone
  still cannot produce the bethl incident; at worst it produces a `land`
  conflict, which stops and reports instead of merging silently.
- **Re-verify after land is unconditional, not STRICT-only.** Isolated
  per-story verify structurally cannot see a problem that only exists in the
  combination of two stories (the Prisma-migration case). Gating this by
  story risk tier would miss exactly the failures it exists to catch, since
  the risk lives in the combination, not in either story alone.
- **Rollback on a failed post-land verify is automatic, not a loud warning
  left for a human to clean up.** `land` only ever reverts the one merge
  commit it just created on the target branch — never touches the story's
  own worktree or any commit that existed before the land ran — so the
  rollback is bounded and reversible by construction, not a `--force`-style
  escape hatch.
- **`ai-flow ship` is not touched.** It already does the right thing once
  handed a single, up-to-date epic branch; the gap this epic closes is
  everything upstream of that.

## Readiness

**ready.** Design, including the two decisions with the highest blast
radius (re-verify scope, rollback behavior), was settled with the user
before this epic was written — not left for `/flow-run` to improvise.

## First story to run

`story-02-01-lock-a-story-before-parallel-work` via `/flow-run`.
