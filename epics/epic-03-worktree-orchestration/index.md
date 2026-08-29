# Epic 03 — Worktree orchestration

## Goal

Running a story never requires a separate, hand-typed `ai-flow worktree add`
(or a guess about where to run it). `/flow-run` reads the epic's own declared
backbone/dependency tree and places each story where its parallel chain
already lives — a new worktree only when the story genuinely opens a new
parallel branch — and lands a chain onto the epic branch by itself the moment
it is proven, cleaning up after itself.

## Why

`skills/flow-plan/SKILL.md` already tells the user that two sibling stories on
parallel branches each get "their own worktree, then a `/flow-run` per
worktree" — but nothing in the tool actually follows that instruction; it is
prose a human has to remember and apply by hand, invocation after invocation.
Two real incidents, both logged 2026-08-27 in `docs/DOGFOODING.md`:

- On **bethl epic-18** (`s1──s2` and `s3──s4──s5`, declared parallel-safe with
  disjoint files), running `flow-run` per story produced placement with no
  visible rule: story-18-01 (root of chain A) got its own worktree, while
  story-18-03 (root of the sibling chain B, meant to run in parallel) landed
  directly on the epic branch in the main checkout. Nothing remembered where
  each chain was running across separate invocations, so the two chains never
  actually got the isolation the plan called for.
- On **bethl epic-19** (`s1 ── s2 ── s3 ── s4`, documented "Chaîne stricte" —
  no parallelism to isolate), `ai-flow next` (`bin/lib/next.js:139-146`) still
  recommended `worktree add --story <dir>` for `story-19-01` — the exact same
  unconditional suggestion it gives every `planned` story, blind to whether
  the epic has any parallel branch to protect. The worktree was created;
  nothing was ever done in it.

A third, smaller defect surfaced in the same investigation: the
`branchPerEpic` policy reminder (`bin/lib/status.js:197-198`) tells the user
to run `ai-flow worktree add --story <dir>` to satisfy "one branch per epic"
— a command that creates a worktree/branch scoped to a *story*, not an epic.
The remediation it prints contradicts the policy it explains.

## Freeze status

Not a freeze exception — same framing as epic-02. `flow-plan`'s own contract
already claims parallel-safe sibling stories run in separate worktrees; this
epic closes the gap between that claim and what the tool actually does once
someone follows it, rather than adding a capability the tool did not
previously claim. It is built strictly on top of epic-02's already-shipped
primitives (`worktree add`/`land`) — no new git mechanics, only the decision
logic for *when* to call them.

## Scope

**In scope**

- Parsing the epic's Backbone / dependency-tree section in `index.md` (the
  `s1 ── s2` / ASCII-tree format `flow-plan` already produces) into a chain
  graph: which stories are sequential (same chain, same location) and which
  are parallel siblings (different chains, separate worktrees).
- A small placement state, one per epic, recording which chain currently
  occupies which location (a worktree path, or "the primary checkout") — read
  fresh on every invocation, not held by a resident process (same
  one-process-per-decision spirit as the guard, `docs/agent-contract.md` §2,
  even though this is not the guard itself). Must live somewhere shared
  across all of the epic's worktrees, not inside any single worktree's own
  `.coding-flow/` (that directory is deliberately per-checkout today — see
  `worktree.js`'s comment on `active-story.json`).
- `/flow-run` uses that graph + state to decide, for the requested story:
  continue in the location already hosting its chain, or open a new worktree
  (`ai-flow worktree add --story <dir>`) because the story starts a new chain
  relative to what is already running.
- Automatic landing: when a story's completion brings its chain to the
  `verified` state `status.js`/`next.js` already compute (an authored `##
  Status: done` plus a green, non-stale verify) *and* no other not-yet-done
  story in that chain remains, automatically run `ai-flow worktree land` and
  remove the worktree directory — and the parent `<repo>-worktrees/`
  directory too, if it was the last one left.
- Fixing the `branchPerEpic` reminder text in `status.js` so its example
  command matches the policy it explains.

**Out of scope — decisions already made with the user**

- **Reconciling epics already mid-flight with inconsistent worktree state**
  (bethl epic-18/19 exactly as they stand today). Placement state starts
  empty for an epic; a worktree that already exists outside this system's
  bookkeeping is not adopted automatically. This is the same gap the
  2026-08-26 `DOGFOODING.md` row already left open ("`status`/`doctor` have
  no way to notice a worktree's branch and origin have unrelated history
  now") — worth a forward pointer, not solved here.
- **Requiring a captured `/flow-review` pass as an auto-land condition.**
  `flow-review` leaves no durable evidence today (no `evidence.json`, unlike
  `verify`); making that mechanically checkable is separate scope. Auto-land
  triggers on exactly the `verified` state `status.js` already derives —
  reuse, not a new proof format.
- **Any change to `worktree land`'s own mechanics** — ff-only/rebase/
  conflict-stop/re-verify/rollback stay exactly as epic-02 built them. This
  epic only decides *when* to call `land`, never how it behaves once called.
- **Any change to `ai-flow ship`.** Same boundary epic-02 drew: ship already
  does the right thing once handed a single, up-to-date epic branch.
- **Cross-epic orchestration.** Placement state and decisions are scoped to
  one epic, matching `branchPerEpic`.

## Backbone

`Backbone: a story is requested → its place in the epic's dependency graph is
read → it is routed to where its chain already lives, or a new worktree opens
for a new chain → the placement is remembered for the next invocation → a
chain that is proven lands itself onto the epic branch and cleans up after
itself`

### Story dependency tree

```text
s1
└── s2

s3
```

`s1` is the walking skeleton: parsing the backbone into a graph, deciding
placement, and actually creating/reusing a worktree for a requested story —
the exact case from both bethl incidents (chain continuation vs. a new
parallel chain), demonstrably alive end to end once it runs, even before
landing exists. `s2` (auto-land + cleanup) depends on `s1`'s placement state
to know which worktree belongs to which chain and whether a story is its
chain's last one. `s3` (the `branchPerEpic` reminder fix) touches only a
printed string in `status.js`, shares no file and no dependency with `s1`/
`s2`, and is independently valuable — it does not need the new placement
logic to be correct on its own, so it is a parallel sibling, not a step on
the same chain.

## Stories

1. **story-03-01-route-a-story-to-its-chains-worktree** — parses the epic's
   backbone/dependency tree, decides where a requested story belongs (its
   chain's existing location, or a new worktree), creates it via the existing
   `ai-flow worktree add`, and persists the decision so the next invocation
   reads it instead of re-guessing. *(STRICT — decides a git-state-changing
   action from parsed text; a wrong placement scatters a user's work, the
   exact class of incident epic-02's rollback exists to bound on the `land`
   side, with nothing equivalent here yet)*
2. **story-03-02-auto-land-a-finished-chain** — when a chain's last story
   reaches the `verified` state, calls `ai-flow worktree land` automatically
   and removes the worktree directory (and the parent `<repo>-worktrees/`
   directory if it was the last one). *(STRICT — merges into the epic branch
   with no separate human trigger; the new trust surface flagged during
   planning)*
3. **story-03-03-fix-branch-per-epic-policy-hint** — the `branchPerEpic`
   reminder in `ai-flow status` stops suggesting a per-story worktree command
   for a policy that wants one branch per epic. *(QUICK)*

## Decisions

- **Auto-land triggers on the existing `verified` derived state, not a new
  "reviewed" proof.** `status.js`/`next.js` already compute "done status +
  green, non-stale verify" as the proven state; reusing it keeps this epic an
  extension of existing machinery rather than a new subsystem, consistent
  with the freeze test. Requiring a captured review pass would need
  `flow-review` to start writing durable evidence first — real scope,
  deliberately left for later.
- **Placement state starts empty per epic; no reconciliation of
  already-diverged worktrees.** Decided with the user: bethl's epic-18/19
  worktrees, created before this system existed, are not adopted or repaired
  automatically. Smaller, safer, and consistent with the still-open
  divergence-detection gap from the 2026-08-26 `DOGFOODING.md` row — this
  epic does not attempt to close that gap.
- **The placement state cannot live inside a single worktree's own
  `.coding-flow/`.** That directory is deliberately per-checkout (see
  `worktree.js`'s comment on `active-story.json`) so that each worktree's
  lock is independent — exactly wrong for state that must be readable from
  *any* of an epic's worktrees. It has to live somewhere shared across all
  worktrees of the same repository — `git rev-parse --git-common-dir` is the
  mechanism git itself uses for exactly this; story-03-01 resolves the
  concrete storage location.
- **A story with no sibling branch never gets a worktree at all.** A backbone
  with no dependency tree (a plain chain, per `flow-plan`'s own convention of
  omitting the tree when there is nothing to branch) or a tree with no
  parallel edges means every story continues wherever its chain already is —
  including the primary checkout, with no worktree created, exactly the
  outcome that should have happened on bethl epic-19.
- **`worktree land`'s own contract is untouched.** This epic only decides
  when to call `add`/`land`; epic-02 already owns what happens once they are
  called, including the re-verify + automatic rollback safety net that
  bounds the blast radius of an auto-land gone wrong.

## Readiness

**ready.** The two decisions with the highest blast radius — what proves a
chain is done enough to auto-land, and whether already-diverged epics get
reconciled — were settled with the user before this epic was written, not
left for `/flow-run` to improvise.

## First story to run

`story-03-01-route-a-story-to-its-chains-worktree` via `/flow-run`.
