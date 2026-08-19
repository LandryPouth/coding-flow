---
name: flow-plan
description: Turn product intent or a brownfield codebase into an implementation-ready epic and vertical stories, each sized to its story: one story.md for a small change, spec.md/plan.md/tasks.md for real feature work. Use to plan work before running it — analyze the request, pick the smallest valuable slice, split into vertical stories, and write the story files. Includes opt-in sections for clarifying ambiguous requirements and for bootstrapping an existing codebase.
---

# Plan

## Overview

Turn product intent or brownfield discovery into an implementation-ready epic.

Your job is not to write a beautiful plan. It is to make the next `/flow-run` able to
one-shot a useful slice with minimal ambiguity. Keep the path short; produce dense,
useful artifacts, not ceremony.

## Conventions

- `{project-root}` means the current repository root.
- Epics live under `epics/epic-NN-name/`; stories under `epics/epic-NN-name/story-NN-MM-name/`.
- A story is a vertical product outcome, not a technical layer.
- `docs/project-context.md` is the durable current-state map only — not a decisions log.
- Detailed story decisions belong in the story plan; execution history in its `## Result`.

## Pipeline

1. Load existing project context when present (`docs/project-context.md`, `docs/architecture.md`, roadmap, existing epics).
2. Decide the smallest valuable epic (see Planning Heuristics). If requirements are ambiguous enough to cause rework, run **Clarify First** below.
3. Create or update the epic `index.md` (goal, scope, ordered stories along a backbone — see below).
4. Define the story sequence — vertical slices, each with concise Implementation Context. Story 01 is the walking skeleton (see below); check every story against INVEST before moving on.
5. For each selected story, write its files at the shape its size calls for (see Story File Contract).
6. Recommend the first story to run with `/flow-run`.

## Planning Heuristics

- Choose the smallest slice that proves value. Prefer "render one real resource
  dynamically" over "migrate all data"; "admin manages one content type" over
  "build the whole admin".
- Split stories by shippable behavior, not by frontend/backend/database.
- Plan heavier for auth, permissions, billing, migrations, external integrations,
  and data modeling; lighter for static UI, copy, and isolated fixes.
- Start with 2–5 stories for a normal epic. Fewer when the first slice validates the
  direction; more only when dependencies or risk require it.
- **Cap an epic around 5–7 stories.** Past that, the epic is no longer one
  shippable capability — split the remainder into a follow-up epic instead of
  growing this one further. A smaller epic also reaches "every story proven"
  sooner, so its PR(s) merge sooner (see auto-merge in `/flow-ship`): a bloated
  epic is not just harder to reason about, it sits open longer.
- Every story is vertical, testable, and carries acceptance criteria.

## Walking Skeleton (Story 01)

The first story of a **new** epic must be the thinnest slice that crosses every
layer the epic will eventually touch — UI (even a bare one) through the real
logic to the real persistence or external call — rather than a single-layer stub
(a UI over no data path, or an endpoint nothing calls yet). Hardcode everything
beyond that one path; that is what later stories are for.

This is not about story size — QUICK/FAST already caps that — it is about
integration. After story 01 ships, the feature is demonstrably alive end to end;
every later story only enriches an already-working path, so the base branch is
never left with a rendered dead end or an orphaned endpoint waiting on a story
that has not shipped. **Stop condition:** if story 01 does not cross every layer
the epic implies, split it further or reorder before writing story 02 — do not
let a later story become the first one to actually connect the pieces.

A single-file QUICK story can be a walking skeleton too — "wire one real path
end to end" is a shape, not a size.

## Backbone (Story Order)

Above the `## Stories` list in `index.md`, add one line — `Backbone: <journey>` —
naming the user or system journey the stories walk, step by step (e.g.
`Backbone: browse → select a plan → pay → confirm`). Story order then reads as
*where on that journey each story sits*, not as arithmetic numbering nobody
re-derives once written. Story 01 is the walking skeleton: the thinnest path
across the whole backbone. Every later story deepens one step of it — reordering
a story should mean moving it to a different point on the stated journey, never
just renumbering.

### Story dependency tree (optional)

The Backbone line orders the journey; it does not say which stories build on
which. When stories have real dependencies — one story lands files or behavior
another story assumes — record them as an ASCII tree in the epic `index.md`,
directly under the Backbone line:

```text
s1
├── s2 ──┐
├── s3 ──┤
└── s4 ──┴── s5
```

Use the short `s<number>` label (matching the numbered `## Stories` list), not
the full story name — the tree stays scannable. Story 01 (the walking skeleton)
is the root; every later story hangs off the story it builds on. Two stories on
sibling branches have no edge between them and run in parallel, each in its own
worktree — `ai-flow worktree add --story <dir>`, then a `/flow-run` per
worktree. An edge is a real build-on relationship: before leaving two stories
unconnected, check their likely files/dirs (from their Implementation Context)
are disjoint — a missing edge claims parallel-safety, and parallel-safety is
checked, not assumed.

A story that consolidates several others (verification, rollout, cleanup)
merges its dependents with `──┴──`, as `s5` above. Write the tree when the
dependency structure goes beyond story order — any branching or merging. For a
plain chain the Backbone already carries the order; omit the tree rather than
drawing a straight line.

## Story File Contract

The shape follows the story's size. Leave the `## Result` section empty for
`/flow-run` to fill after implementation.

### QUICK / FAST stories — one file

A copy change, an isolated fix, a low-risk local change: write a single
**`story.md`** with the sections that actually carry information — a `# Title`,
acceptance criteria, a `## Commands` block, and an empty `## Result`. Skip the rest.

Three files for a one-line change means three files to create, three to re-read on
every later turn, and two to update at the end — to record that a heading changed.
The tool reads either shape, so this costs nothing in traceability: a single-file
story verifies, reaches `verified`, and audits exactly like a three-file one.

### STANDARD / STRICT stories — three files

The split earns itself once a story is worth a day's work:

- **`spec.md`** — what & acceptance: user value, requirements, acceptance criteria
  (observable and testable), edge cases (correctness/security/UX/data), UX notes,
  out-of-scope items to prevent scope creep.
- **`plan.md`** — how: concise `Implementation Context` (likely files/dirs, search
  anchors, execution mode `QUICK|FAST|STANDARD|STRICT`, scout pre-step `yes/no`,
  areas to avoid), technical notes, `## Decisions` (meaningful tradeoffs), a test
  plan, `## Acceptance Traceability` (criterion → `file::test`), and a `## Commands`
  block with the validation commands.
- **`tasks.md`** — the execution checklist starting with targeted discovery, plus an
  empty `## Result` section (with `### Rollback Notes`) the worker fills after running.

Mention security and permissions when behavior is privileged; mention data ownership
and migration when persistence changes. Avoid micro-stories like "create DTO".

## Context Efficiency

Planning should make implementation one-shot without forcing `/flow-run` to rediscover
the whole project. For each story, capture likely files/directories, search anchors,
the execution mode, whether a scout pre-step is needed, areas to avoid, and the
validation focus. Mark `scout pre-step: yes` only when broad, cross-module, or
high-risk discovery would otherwise be needed — never for small isolated stories.

## Clarify First (opt-in)

When requirements are ambiguous enough to cause rework, pressure-test them before
writing stories. Ask the fewest questions that prevent the most rework — one per
turn, in the user's language; stop when the next question would not change
implementation. Budget: 5–15 questions for a normal feature, 10–20 for auth,
migration, billing, permissions, or data modeling. Highest-value question types:

- Scope boundary — what is explicitly out of scope?
- Actor/permission — who can do this, and who cannot?
- Data truth — where does this data come from and who owns it?
- Failure mode — what should happen when this fails?
- UX decision — what should the user see at the decision point?
- Migration — must existing data be preserved or transformed?
- Validation — what would prove this is done?

Prefer a labeled assumption over a question that would not change implementation.

### INVEST Check

Before the readiness verdict, check every story against INVEST — the failure
modes it catches are the ones no amount of clarifying questions would surface:

- **Independent** — does not require another not-yet-done story of *this* epic
  to be minimally useful or testable on its own. A story-04 that silently needs
  story-03 finished first is exactly the ordering hazard Walking Skeleton exists
  to prevent for story 01, and it can recur at any position.
- **Negotiable** — a slice of scope, not a rigid spec handed down whole.
- **Valuable** — delivers an observable user or system outcome, not an internal
  layer nobody can see land.
- **Estimable** — sizeable without further discovery; if it cannot be sized, it
  is not ready to write, it is still a question.
- **Small** — fits one focused `/flow-run` pass (QUICK through STRICT), not
  several days of work wearing one name.
- **Testable** — has acceptance criteria concrete enough to verify.

A story that fails Independent or Small is a split, not a note for later.

### Readiness Gate

When the questions stop, record a verdict instead of sliding into writing. Judge
it against the stopping criterion: *would the next question change
implementation?*

- **`ready`** — no open question would change implementation. Write the stories.
- **`not ready`** — a blocking question is still open. Do not write stories yet:
  ask the highest-leverage follow-up, surface the missing decision to the user as
  a labeled question, or cut scope until it no longer matters. Record what is
  blocking.

Record the verdict — and the blocking item when `not ready` — in the epic
`index.md`, so `/flow-run` starts from a plan explicitly judged ready, not from
silence.

## Brownfield Bootstrap (opt-in)

For an existing codebase, prepare durable project docs before creating stories. Do
not modify application code.

1. Run `ai-flow bootstrap --scan --json` and read its output. The scan is mechanical
   — directories, scripts, declared dependencies — and costs milliseconds, so always
   run it fresh rather than trusting a `docs/bootstrap-scan.md` that may be stale.
   Then inspect only the files needed to verify framework, scripts, architecture,
   tests, and conventions.
   - If the scan reports `"classification": "empty"` while the repo clearly holds
     code, the detectors (JavaScript only) did not recognize the stack. Say so, and
     derive the facts by reading the project directly instead of trusting the scan.
2. Update `docs/project-context.md`, `docs/architecture.md`, `docs/conventions.md`,
   and `docs/roadmap.md` with durable current-state facts — current architecture,
   existing patterns, hardcoded data, coupling points, migration risks, and the first
   safe vertical slice.
3. Do not dump the full audit into the docs; summarize. Mark uncertain findings as
   assumptions. Preserve existing human-written docs when they are more specific.
4. Do not create an epic unless the user asks.

## Greenfield Additions

For a new project, first define the product goal, target users, initial stack
assumptions, architecture constraints, validation strategy, and the smallest
shippable slice.

## Rules

- Prefer vertical slices; avoid enterprise ceremony and vague tasks.
- Every story must be testable and carry acceptance criteria.
- Update `project-context.md` only when the durable project state changes.
- Do not create documents that no agent will read.

## Verification

Before reporting the plan as done:

- [ ] Every story file named under `## Generated Files` exists on disk — checked,
      not assumed.
- [ ] Story 01 is a walking skeleton: it delivers end-to-end value on its own
      rather than being one horizontal layer of several.
- [ ] Each story's acceptance criteria are `- [ ]` checklist items in
      Given/When/Then form. Criteria written as prose are invisible to `verify`,
      which lists the unticked ones back on every green run and cannot see these.
- [ ] `ai-flow doctor` ran and reports no duplicate story numbering and no
      oversized epic.
- [ ] Any story dependency tree written has its edges backed by real
      build-on relationships — checked, not assumed.
- [ ] No implementation happened. Planning writes story files; `/flow-run` writes
      code.

A criterion with no observable outcome cannot be verified and cannot be reviewed.
Rewrite it here, where it is cheap, rather than handing it to `/flow-run`.

## Output

```md
# Plan Result

## Epic

- Path:
- Goal:
- Scope:

## Stories

-

## First Story To Run

-

## Generated Files

-

## Assumptions

-

## Risks

-

## Clarification Readiness

ready / not ready — include only when Clarify First ran

## Recommended Next Command

Use /flow-run for ...
```
