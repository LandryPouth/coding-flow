# Epic 18 — The run remembers

## Goal

Every run leaves a durable, structured trace that survives the worktree it ran
in: an append-only event journal written by the CLI itself, proof that is not
lost on land, review findings recorded as they were found (not after the
fixes), and acceptance ticks that point at the proof behind them. This is the
data layer every later epic of the factory reads (design-decisions entry 15).

## Why

Measured on 2026-11-12 (`docs/plans/autonomous-factory.md`, baseline):

- **Proof is lost.** `autoland` and `worktree remove` delete the worktree's
  `.coding-flow/runs/`; finished stories then read `written; no verify
  captured` (DOGFOODING 2026-11-09, 2026-11-10; epic 17's Why). An unattended
  epic would report every story `in-progress`.
- **Reviews record the residue.** `review capture --p0..--p3` is called after
  the fixes, so 184 bethl reviews say self-review finds more (0.28 p0+p1 per
  review) than the independent one (0.17) — the opposite of what happened
  (DOGFOODING 2026-11-12). The comparison that prices independent review is
  impossible today.
- **Nothing records what happened between two verifies**: gates and what was
  done about them, status changes, locks, lands, kills. The 2026-11-12 bilan
  was written from a session's memory, compacted hours later.
- **A notes-only edit restales the proof.** Ticking a box or writing the
  `## Result` after a green verify forces a 3–9 minute rerun that tells
  nothing new (bethl bilan, P1).
- **Ticks are claims.** Criteria were ticked before verify, and `done` written
  before review, at least once each on bethl epics 37–39. Entry 9 keeps
  criteria surfaced, enforced on request; a driven run is that request.

## Scope

**In scope**

- `.coding-flow/events.jsonl`: versioned schema, append-only, written by the
  CLI at the moments it already knows about (verify, gates, review, status,
  worktree, land). One reader in an existing command.
- Evidence carried into the primary checkout on land/autoland; JSONL files
  that two branches append to merge without conflict.
- A proof that stays fresh across an edit confined to the story's own notes.
- Review capture in two steps, find then resolve, with the reviewer's origin.
- Ticked acceptance criteria tied to the traceability that proves them, in
  driven runs and on request.

**Out of scope**

- Any metric computed from the journal (epic 21), the vault (epic 21), human
  turn classification (epic 21), decisions (epic 22).
- Changing what makes a verify green. This epic records; it never relaxes.
- Network, telemetry upload, a database.

## Backbone

`Backbone: a verify leaves an event → its proof survives the land → a note edit keeps it fresh → a review is captured as found → every gate, status and lock leaves an event → a ticked box names its proof`

### Story dependency tree

```text
s1
├── s4
└── s5

s2

s3

s6
```

s1 lands the journal writer that s4 and s5 append to. s2 (worktree/land),
s3 (freshness in the harness) and s6 (acceptance criteria) touch disjoint
files and need no journal; s5 also emits land events, so run it after s2 when
both are open (same `worktree.js` edit points).

## Stories

1. **story-18-01-verify-writes-the-journal** *(STANDARD — walking skeleton: verify writes `verify.start`/`verify.end`, `ai-flow report` shows the last events)*
2. **story-18-02-proof-survives-the-land** *(STRICT — evidence keys and file moves across checkouts)*
3. **story-18-03-a-notes-only-edit-keeps-the-proof** *(STRICT — changes what counts as stale)*
4. **story-18-04-review-findings-are-captured-before-fixes** *(STANDARD)*
5. **story-18-05-gates-status-and-worktrees-leave-events** *(STANDARD)*
6. **story-18-06-a-ticked-criterion-names-its-proof** *(STRICT — a claim-binding rule, entry 9)*

## Decisions

- **The CLI writes the journal, never the agent.** An event is emitted by the
  command that observed the fact. Agents read it; nothing an agent says is an
  event (the same rule as verify: what ran counts, what was claimed does not).
- **JSONL, append-only, one schema version field per line**, repo-relative
  paths only, no command output beyond what evidence already keeps. The
  journal follows the project's choice for `runs/` (tracked in bethl, ignored
  in coding-flow); where tracked, the `.jsonl` files get `merge=union` in
  `.gitattributes` so parallel branches never conflict on them (bethl:
  `guard-unchecked.jsonl` conflicts at merge, DOGFOODING P2). Where ignored,
  s2 is what keeps them from dying with the worktree.
- **Legacy `review capture --p0..` keeps working** and is recorded as
  `origin: legacy-counts`, so old data is never mistaken for found-counts.
- **A notes-only edit is narrow:** only the story's `## Result` (with Rollback
  Notes) and checkbox state in `tasks.md`. Any change to `spec.md`,
  acceptance-criteria text, `## Commands`, or code still restales. Signals only
  lower claims (entry 9): if in doubt, stale.

## Readiness

`ready`. No open question changes implementation. Assumption (default, open to
veto): the journal lives at `.coding-flow/events.jsonl`, next to `runs/`, and
shares its tracked-or-ignored status.
