# Epic 04 — Review evidence & gating

## Goal

A `/flow-review` verdict becomes a fact the tool can check later — fresh or
stale, pass or fail — instead of prose in a story's `tasks.md` that only the
session which wrote it remembers. For STRICT-tier work, a story cannot be
auto-landed or read as ready-to-ship on a green verify alone while it has no
fresh, passing review behind it. And the one review pass STRICT already
requires actually catches more per pass — through structural risk signals and
an enforced independent, adversarial framing — instead of needing several
days of passes to converge, without defaulting to expensive parallel
subagent fan-out to get there.

## Why

Finishing story-03-02 needed **six** separate `/flow-review` passes across
several days before it was actually correct — each pass found a genuine,
distinct P0/P1 an earlier pass missed (a stale-freshness gate that would have
blocked every real multi-story chain forever, a cross-chain landing mismatch
that silently landed the wrong worktree, an uncaught crash on this project's
own `.gitignore`, an unserialized `land` racing the shared checkout, and a
lock leaked by an unguarded `process.exit()` inside `landCleanup`). Nothing
shipped broken — STRICT's "review required" rule did eventually catch every
defect — but the repeated-pass cost, in tokens, days, and trust in the tool,
was real. Logged 2026-08-29 in `docs/DOGFOODING.md`.

Two gaps sit behind that cost, both already named (and deliberately deferred)
in `epics/epic-03-worktree-orchestration/index.md`'s own Decisions:

- **No durable review evidence.** `flow-review` writes markdown to the
  terminal and, at best, prose into a story's `tasks.md` — nothing like
  `verify`'s `evidence.json`/`runs/*.json` that a later session, or the tool
  itself, can read back and trust without re-reading the whole diff and
  narrative from scratch. So nothing can gate on "this was reviewed and
  passed" — only on "this was reviewed" in the loosest, unverifiable sense.
- **No forcing function for a single pass to be thorough.** STRICT already
  says "an independent pass is the point of STRICT," but nothing enforces
  that the pass is *actually* independent (several of the six passes on
  story-03-02 were closer to the same session re-reading its own reasoning —
  the exact weak case `flow-review/SKILL.md`'s own "Reviewing Your Own Diff"
  section already warns about) or that it goes Deep on the dimensions the
  diff's own risk already flags, rather than leaving that as a judgment call
  a rushed pass can decline.

A third, smaller gap surfaced investigating the first: `docs/DOGFOODING.md`
already had an **open row from 2026-08-28** — `scoreDiffRisk` (the structural
half of the risk scorer) matched only file *paths*, not what a diff actually
*does*, so story-03-02's own diff (new automated `git branch -D`/`git
worktree remove`/unattended-merge code) scored `low`/`not-required` despite
being exactly the shape STRICT exists to catch. This epic closes that row
too, rather than leaving it as separate, indefinitely-deferred scope.

## Freeze status

Not a freeze exception — same framing as epic-02/epic-03. This is dogfooding
friction recorded in `docs/DOGFOODING.md` per this project's own freeze rule
(bugs, DX, docs, and tests stay in scope during the freeze); it builds
strictly on existing proof machinery (`verify`'s evidence/freshness pattern,
the existing risk scorer, the existing STRICT/Deep vocabulary) rather than
adding a new capability the tool did not already claim.

## Scope

**In scope**

- A durable, tree-token-freshness-aware evidence file `/flow-review` writes
  per pass, read back the same way `verify` evidence already is.
- Gating `chainIsFinished`/auto-land and `next`'s ready-to-ship tier on that
  evidence for STRICT-tier stories only — QUICK/STANDARD unaffected.
- Extending `scoreDiffRisk` with structural git-operation signals (not just
  path patterns), and shipping one concrete `config.validation.quality`
  check as a worked example: a cheap, deterministic scan for the exact bug
  class that took the most review passes to find by hand (a `fail()`/
  `process.exit()` reachable from inside a `withFileLock`-style locked
  callback).
- Sharpening `flow-run`'s "Review Before Done" and `flow-review`'s dimension
  selection so the one pass STRICT requires is genuinely independent
  (fresh subagent, artifact + contract only, adversarial framing) and
  defaults to Deep on the dimensions STRICT risk already flags.

**Out of scope — decisions made while planning**

- **Parallel multi-subagent fan-out as the STRICT default.** Each additional
  subagent context re-reads the full diff and contract, so cost multiplies
  roughly per added dimension; the cheapest, most mechanical misses (the
  kind a second linear read would also catch) are closed instead by
  structural checks and independence, not more parallel reviewers. Multi-
  agent review stays available as `/code-review ultra`, an explicit,
  separately-invoked path — not folded into the STRICT default here.
- **A general, project-agnostic static-analysis engine.** The one
  deterministic check this epic ships is scoped to this project's own
  `withFileLock`/`fail()` naming convention — a worked example other
  projects can copy and adapt, not a universal linter. A false-positive-rare,
  false-negative-tolerant heuristic is the right size for one project's one
  convention; a general points-to/AST engine is not justified by one bug
  class.
- **Any change to `verify`'s own contract, evidence shape, or `land`'s
  merge/rebase/rollback mechanics.** This epic adds a second, parallel kind
  of evidence and reuses `verify`'s freshness plumbing (`isStale`,
  `currentTreeToken`) unchanged — it does not touch what `verify` or `land`
  already do.
- **Gating QUICK/STANDARD stories on review evidence.** Review stays opt-in
  below STRICT, per `flow-run/SKILL.md`'s existing intensity model; this
  epic does not raise that floor.

## Backbone

`Backbone: a STRICT story finishes → its review verdict is captured as
durable, freshness-aware evidence → done/auto-land refuses to call a STRICT
story finished until that evidence is a fresh pass → the risk that decided
"this needed review" is itself read from what the diff actually does, not
keyword matching → the one review pass STRICT requires is genuinely
independent and goes Deep on the dimensions that risk already flagged`

### Story dependency tree

```text
s1
└── s2

s3

s4
```

`s1` is the walking skeleton: capture (write) → storage (`.coding-flow/runs/`,
same home `verify` evidence already uses) → read-back (a freshness-aware
reader) → visible outcome (`ai-flow status` shows a story's review as
fresh-pass / stale / fail / none) — demonstrably alive end to end before
anything gates on it. `s2` depends on `s1`'s reader to decide auto-land/
ready-to-ship. `s3` (structural risk signals + the deterministic check) and
`s4` (independent, adversarial, Deep-by-default review) touch neither `s1`
nor `s2`'s files and stand on their own value — parallel siblings, each in
its own worktree.

## Stories

1. **story-04-01-capture-durable-review-evidence** — `/flow-review` writes a
   captured evidence file per pass (verdict, dimensions run, finding counts,
   tree token), readable back with the same freshness rule `verify` evidence
   already uses; surfaced in `ai-flow status`. *(STRICT — a later story gates
   real merges on this evidence; a wrong freshness/verdict computation here
   would silently let a broken story look reviewed)*
2. **story-04-02-gate-strict-completion-on-a-passing-review** — a STRICT-tier
   chain member with no fresh, passing review evidence is not "finished":
   auto-land refuses it, and `next`'s ready-to-ship tier names review as the
   missing step. QUICK/STANDARD stories are unaffected. *(STRICT — directly
   gates auto-land and the ready-to-ship recommendation)*
3. **story-04-03-score-diff-risk-from-structural-git-signals** — `scoreDiffRisk`
   also reads what a diff *does* (unconditional worktree/branch/merge
   mutation) not just which paths it touches; ships one concrete
   `config.validation.quality` check catching the exact lock/`process.exit()`
   bug class story-03-02's sixth review pass found by hand. Closes the
   2026-08-28 `DOGFOODING.md` row. *(STANDARD — a risk-scoring/tooling
   heuristic, not itself a merge action; a miss here is caught downstream by
   s1/s2's review gate, not shipped silently)*
4. **story-04-04-require-an-independent-adversarial-review-pass** — `flow-run`'s
   "Review Before Done" explicitly delegates STRICT self-review to a fresh
   subagent given the artifact and the contract only, adversarially framed;
   `flow-review`'s dimension selection defaults Architecture/Tests/Security to
   Deep once the diff's own risk is already STRICT. *(QUICK — prose-only
   change to two skill files and their synced copies)*

## Decisions

- **Gate on the existing risk tier, not a new "review-required" flag.**
  `combineRisk(scoreStoryRisk(...), scoreDiffRisk(...))` (`bin/lib/harness.js`)
  already decides STRICT; story-04-02 reuses that computation exactly rather
  than inventing a second risk model that could disagree with the first.
- **Review evidence reuses `verify`'s freshness plumbing unchanged.**
  `isStale`/`currentTreeToken` (`bin/lib/audit.js`, `bin/lib/identity.js`)
  already express "does this proof still describe the current tree" in a
  form independent of what kind of proof it is; a review-evidence entry
  shaped `{ ok, treeToken }` reuses `isStale` as-is. Writing a second
  staleness rule for the same underlying question was rejected as
  duplicated logic that could drift from the original.
- **No parallel-subagent default.** See Scope's "out of scope" entry above —
  recorded here too because it is the single highest-leverage cost decision
  in the epic: the token budget goes to structural checks (near-zero
  marginal cost, ride inside `verify`, which already runs) and independence
  (bounded, one extra fresh context) before it goes to running the same
  review N times in parallel across N dimensions.
- **The deterministic check ships as this project's own opt-in
  `config.validation.quality` entry, not a built-in gate every project
  inherits.** Matches how `validation.quality` already works for every other
  project-declared quality check (RULES.md: "declare them in
  `.coding-flow/config.json` under `validation.quality`... not asserted") —
  this epic dogfoods the mechanism on coding-flow itself rather than adding
  a new one.

## Readiness

**ready.** The two decisions with the most cost impact — reuse the existing
risk tier instead of a new flag, and do not default to parallel subagent
fan-out — were made during planning, not left for `/flow-run` to improvise
under token pressure.

## First story to run

`story-04-01-capture-durable-review-evidence` via `/flow-run`.
