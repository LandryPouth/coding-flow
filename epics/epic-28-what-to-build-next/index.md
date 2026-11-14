# Epic 28 — What to build next

## Goal

When nothing is left to run, Coding Flow tells the maintainer what the
repository itself says could come next — at most three ideas, each with the
file, criterion or sentence it comes from — and remembers what the
maintainer did with each one. It never plans an idea on its own.

## Why

- The maintainer asked for it (2026-11-14): "I liked that Coding Flow proposed
  features useful to the app that I had not even thought of … I don't
  necessarily know what to implement next … the recommendations are great",
  with the explicit worry of over-engineering: "it now comes from the dev's
  wish".
- What he liked was not a feature: the ideas came from bethl's
  `docs/roadmap.md`, written once by the brownfield bootstrap on 2026-05-26
  and never refreshed. `ai-flow next` only ranks stories that exist; with
  none left it has nothing to say. Epic 23 proposes improvements to *Coding
  Flow*, never to the project.
- The repository already holds the ideas, unread. bethl on 2026-11-14:
  2 notification types declared in the schema "À venir … pas encore produit"
  (`apps/api/prisma/schema.prisma:1402`), 77 criteria deferred `[~]` across
  old stories, 5 `Assumption (unconfirmed)` markers, unchecked roadmap lines,
  "Later" items in epic indexes.
- The research behind `/flow-plan` (`docs/research/reports/Améliorer flow
  plan.md`) is the guard: claims an agent invents about users have weak
  validity; the fix is a provenance label on every product claim
  (`user-stated`, `repo-observed` with a path, `web-sourced`, `assumption`).
  An idea with no source is not shown.

## Scope

**In scope**

- A project ledger `docs/ideas.md`: one line per idea, with its source, size
  and status (`proposed`, `planned`, `parked`, `killed: <reason>`).
- A mechanical scan (no model) of the signals the repo already writes:
  deferred criteria, unconfirmed assumptions, unchecked roadmap lines,
  "Later"/out-of-scope items of epic indexes, code markers the project
  declares (`ideas.markers`, e.g. "À venir", "not yet produced").
- `ai-flow next`: an **Ideas** block, three lines at most, only when no story
  is left to run (the We need you block of 26-07 still comes first).
- `ai-flow idea plan|park|kill <id>`; killed ideas never return.
- `/flow-plan --ideas`: an on-demand judgment pass in a fresh context that
  ranks the scanned candidates by value to the product and may add ideas it
  can source (a model with no service, an enum never produced, a page with
  no entry point) — always with a path.

**Out of scope**

- Planning an idea without the maintainer (`idea plan` hands it to
  `/flow-plan`, which still asks).
- Market, competitor or user research (web-sourced ideas stay a manual
  `/flow-plan` input).
- Ideas about Coding Flow itself (epic 23).

## Backbone

The repo carries signals → the scan turns them into sourced candidates in
`docs/ideas.md` → `next` shows three when nothing is left → the maintainer
plans, parks or kills each → on demand, a judge ranks them and adds the
ones only reading the code can find.

## Stories

1. **story-28-01-ideas-from-the-repo** *(STANDARD — ledger, scan, `next`
   block, `idea` commands)*
2. **story-28-02-ideas-judged-on-demand** *(STANDARD — `/flow-plan --ideas`,
   provenance enforced)*

## Decisions

- **A block of `next`, not a tier.** Ideas never outrank work: they appear
  only when no tier has a command to run.
- **No source, no idea.** Every line carries `source:`; the scan cannot
  produce one without it, and 28-02's judge has its output rejected without
  it.
- **The ledger is the memory.** `killed` ideas are matched by id and by
  normalized source, so the same deferred criterion is not proposed twice.
- **Three, then silence.** More would read as a backlog the maintainer did
  not ask for — the over-engineering he named.
- **Proven first by hand.** The bethl `epic-run` workflow writes the same
  ledger format at the end of each epic (2026-11-14), so the format and the
  value are seen on real epics before this epic is built.

## Dependencies outside this epic

26-07 (the `next` block layout and its `--json` shape), 16-01 (the
`Assumption (unconfirmed)` marker read by the scan).

## Delivery order

28-01 with step 0 of `docs/plans/autonomous-factory.md` (no factory needed,
right after 26-07). 28-02 with step 4 (learning), after 23.

## Readiness

`ready`.

## Maintainer cleanup on delivery

- Remove the "Idées pour la suite" step from the `epic-run` workflow and
  skill (`~/.claude/workflows/epic-run.js`, `~/.claude/skills/epic-run/SKILL.md`)
  once `next` shows the Ideas block; the ledgers it wrote stay.
