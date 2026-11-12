---
name: flow-plan
description: Turn product intent or a brownfield codebase into an implementation-ready epic and vertical stories, each sized to its story: one story.md for a small change, spec.md/plan.md/tasks.md for real feature work. Use to plan work before running it — analyze the request, pick the smallest valuable slice, split into vertical stories, and write the story files. Includes opt-in sections for clarifying ambiguous requirements and for bootstrapping an existing codebase.
---

# Plan

## Overview

Turn product intent or brownfield discovery into an implementation-ready epic. The
goal is not a beautiful plan: it is a next `/flow-run` that one-shots a useful slice
with minimal ambiguity. Dense artifacts, no ceremony, no document no agent will read.

## Conventions

- Epics live under `epics/epic-NN-name/`; stories under
  `epics/epic-NN-name/story-NN-MM-name/`.
- A story is a vertical product outcome, not a technical layer.
- `docs/project-context.md` is the durable current-state map, updated only when that
  state changes — never a decisions log. Story decisions go in the story's
  `## Decisions`; execution history in its `## Result`.

## Pipeline

1. Read the existing context when present: `docs/project-context.md`,
   `docs/architecture.md`, the roadmap, existing epics.
2. Pick the smallest valuable epic (Planning Heuristics). If ambiguity could cause
   rework, run **Clarify First**.
3. Write the epic `index.md`: goal, scope, and the stories ordered along a backbone.
4. Define the stories as vertical slices, each with a short Implementation Context.
   Story 01 is the walking skeleton; check every story against INVEST.
5. Write each story's files at the shape its size calls for (Story File Contract).
6. Recommend the first story to run with `/flow-run`.

## Planning Heuristics

- The smallest slice that proves value: "render one real resource dynamically", not
  "migrate all data"; "admin manages one content type", not "the whole admin".
- Split by shippable behavior, never by frontend/backend/database.
- Plan heavier for auth, permissions, billing, migrations, external integrations and
  data modeling; lighter for static UI, copy and isolated fixes.
- 2–5 stories for a normal epic; **cap it around 5–7**. Past that it is no longer one
  shippable capability — split the rest into a follow-up epic. A small epic also
  reaches "every story proven", and merges, sooner.
- **Corpus first for a parser- or policy-shaped epic** (a shell reader, a path
  policy, a config parser, a route scanner): the case corpus is story 01 — "the
  corpus runs, red where unhandled" — and later stories turn rows green. Written
  last, the spec is discovered one missing case per review pass (epic 05: 10–12
  passes per story).

## Walking Skeleton (Story 01)

Story 01 of a **new** epic is the thinnest slice that crosses every layer the epic
will touch — UI (even a bare one) through the real logic to the real persistence or
external call — never a single-layer stub (a UI over no data path, an endpoint
nothing calls). Hardcode everything beyond that one path. It is about integration,
not size: a single-file QUICK story can be one. Once it ships, the feature is alive
end to end and every later story only enriches a working path. **Stop condition:**
if story 01 does not cross every layer, split or reorder before writing story 02.

## Backbone (Story Order)

In `index.md`, a `## Backbone` section above `## Stories` names the journey the
stories walk in one line: `Backbone: browse → select a plan → pay → confirm`. Story
01 is the thinnest path across it; each later story deepens one step. Reordering a
story means moving it to another point on the journey, never just renumbering.

### Story dependency tree (optional)

When stories have real dependencies — one lands files or behavior another assumes —
draw them in a fenced block **inside the `## Backbone` section** (anywhere else the
tree is ignored and the stories run as one plain chain), with the `s<number>` labels
of `## Stories`. `ai-flow worktree place` reads it to run independent chains in
parallel, so only these shapes parse:

```text
s1
├── s2
│   └── s4
└── s3

s5
```

- Story 01 is the root. Every other line is `├──` or `└──` and **one** label,
  indented 4 characters (`│   ` or spaces) per level. A paragraph of flat chains,
  one per line (`s1 ── s2 ── s3`), parses too — but not mixed into an indented one.
- A story that builds on nothing in the epic is its own root, in its own paragraph
  after a blank line (`s5` above).
- Every story has **one parent**: no merge (`┴`, `┤`). A story that needs several
  (verification, rollout, cleanup) is drawn as its own root, and its story names
  the stories that must land before it starts — a root starts from the base, which
  holds their code only once they have landed.
- Every story of `## Stories` appears in the tree, each after its parent in the list.

Two stories on sibling branches run in parallel, each in its own worktree
(`ai-flow worktree add --story <dir>`, then a `/flow-run` per worktree). A missing
edge claims parallel-safety: check their likely files are disjoint before leaving
two stories unconnected. Write a tree only when there is branching; for a plain
chain the Backbone already carries the order.

## Boundaries (when the epic adds a module)

An epic that adds a module — a top-level package, layer or bounded area — records
the dependencies it creates in `index.md`, under the Backbone:

```md
## Boundaries

- allowed: `billing` → `domain`
- forbidden: `billing` → `ui`
- forbidden: `domain` → the database client

approved by: <human name>
```

A boundary is a decision, so a human makes it: show the lines to the user and record
the name they give. Never fill it in yourself — the tool cannot know who is human.
Point at the project's own check: `ai-flow bootstrap --scan --json` lists
`qualityRecipes` (dependency-cruiser, import-linter, ArchUnit, ESLint `complexity`)
and which config already exists. The story that writes that config carries the rule;
loosening it later is reported as `policy-changed`. An epic that adds no module has
no `## Boundaries` section.

## Story File Contract

The shape follows the story's size. Leave `## Result` empty for `/flow-run`, and keep
any `## Status` line in `tasks.md` or `story.md` — a `## Status` in `spec.md` is not
read.

### QUICK / FAST stories — one file

A copy change, an isolated fix, a low-risk local change: one **`story.md`** with only
the sections that carry information — a `# Title`, the acceptance criteria, a
`## Commands` fenced block (one command per line) and an empty `## Result`. It
verifies and audits exactly like a three-file story, without three files to re-read
on every later turn.

### STANDARD / STRICT stories — three files

- **`spec.md`** — what and acceptance: user value, requirements, acceptance criteria
  (observable, testable), edge cases (correctness, security, UX, data), UX notes,
  out of scope.
- **`plan.md`** — how: `Implementation Context` (likely files/dirs, search anchors,
  execution mode `QUICK|FAST|STANDARD|STRICT`, scout pre-step `yes/no`, areas to
  avoid, validation focus), technical notes, `## Decisions`, a test plan, `## Acceptance Traceability`
  (criterion → `file::test`), and `## Commands`: a fenced block, one command per
  line, no bullets or labels (`verify` reads only that).
- **`tasks.md`** — the checklist, starting with targeted discovery, and an empty
  `## Result` with `### Rollback Notes`.

In either shape, write each command as the project's own script when it has one,
bare (`npm test`, `pnpm run lint`): `verify` runs those when nobody is watching —
every agent run — and refuses any other command there until the user declares it in
`.coding-flow/config.json`.

The Implementation Context is what lets `/flow-run` one-shot the story without
rediscovering the project. Mark `scout pre-step: yes` only for broad, cross-module or
high-risk discovery. Name security and permissions when behavior is privileged, data
ownership and migration when persistence changes. No micro-stories ("create DTO").

## Clarify First (opt-in)

When ambiguity could cause rework, pressure-test the request before writing stories:
the fewest questions that prevent the most rework, one per turn, in the user's
language. Stop when the next question would not change implementation. Budget: 5–15
questions, 10–20 for auth, migration, billing, permissions or data modeling. The
highest-value kinds:

- Scope boundary — what is explicitly out?
- Actor/permission — who can do this, and who cannot?
- Data truth — where does the data come from, and who owns it?
- Failure mode — what happens when this fails?
- UX decision — what does the user see at the decision point?
- Migration — must existing data be preserved or transformed?
- Validation — what would prove this is done?

Prefer a labeled assumption over a question that would not change implementation.

When the open question is how something should behave or look, a throwaway prototype
settles it faster than another question. It is not implementation: build it outside
the product tree (a scratch directory, or a branch that is never merged), show it,
record the verdict in the story's `## Decisions`, and keep only the decision.

### INVEST Check

Before the readiness verdict, check every story:

- **Independent** — useful and testable without another not-yet-done story of this
  epic. A story 04 that silently needs story 03 is the ordering hazard the walking
  skeleton prevents for story 01, at any position.
- **Negotiable** — a slice of scope, not a rigid spec handed down whole.
- **Valuable** — an observable user or system outcome, not an invisible layer.
- **Estimable** — sizeable without more discovery; otherwise it is still a question.
- **Small** — one focused `/flow-run` pass, not days of work under one name.
- **Testable** — criteria concrete enough to verify.

A story that fails Independent or Small is a split, not a note for later.

### Readiness Gate

When the questions stop, record a verdict against the stopping rule — *would the
next question change implementation?* — instead of sliding into writing:

- **`ready`** — no open question would change implementation. Write the stories.
- **`not ready`** — a blocking question is open. Write no stories: ask the
  highest-leverage follow-up, put the missing decision to the user as a labeled
  question, or cut scope until it no longer matters.
- An epic that adds a module is **`not ready`** while its `## Boundaries` section is
  missing or has no `approved by:` name.

Record the verdict, and the blocking item when `not ready`, in the epic `index.md`.

## Brownfield Bootstrap (opt-in)

For an existing codebase, write durable project docs before any story. Application
code is not modified, and no epic is created unless the user asks.

1. Run `ai-flow bootstrap --scan --json` fresh (it is mechanical and takes
   milliseconds; a `docs/bootstrap-scan.md` may be stale), then read only the files
   needed to confirm framework, scripts, architecture, tests and conventions. If it
   says `"classification": "empty"` while the repo clearly holds code, the detectors
   (JavaScript only) missed the stack: say so, and read the project directly.
2. Write current-state facts into `docs/project-context.md`, `docs/architecture.md`,
   `docs/conventions.md` and `docs/roadmap.md`: architecture, existing patterns,
   hardcoded data, coupling points, migration risks, the first safe vertical slice.
3. Summarize rather than dump the audit; mark uncertain findings as assumptions;
   keep human-written docs that are more specific.

## Greenfield Additions

For a new project, first define the product goal, target users, initial stack
assumptions, architecture constraints, validation strategy, and the smallest
shippable slice.

## Verification

Before reporting the plan as done:

- [ ] Every file under `## Generated Files` exists on disk — checked, not assumed.
- [ ] Story 01 is a walking skeleton: end-to-end value on its own, not one layer.
- [ ] Every acceptance criterion is a `- [ ]` item in Given/When/Then form — prose
      criteria are invisible to `verify`.
- [ ] `ai-flow doctor` ran and reports no duplicate story numbering and no
      oversized epic.
- [ ] Any dependency tree uses only the shapes above, and each edge is a real
      build-on relationship — checked, not assumed.
- [ ] An epic that adds a module carries `## Boundaries` with an `approved by:` name
      the user gave.
- [ ] No implementation happened: planning writes story files, `/flow-run` writes
      code.

A criterion with no observable outcome can be neither verified nor reviewed: rewrite
it here, where it is cheap.

## Output

`# Plan Result`, then these `##` sections in order: Epic (path, goal, scope),
Stories, First Story To Run, Generated Files, Assumptions, Risks, Clarification
Readiness (`ready` / `not ready`, only when Clarify First ran), Recommended Next
Command (`Use /flow-run for …`).
