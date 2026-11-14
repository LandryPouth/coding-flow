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
3. Write the epic `index.md`: the `## Intent`, scope, and the stories ordered along
   a backbone.
4. Define the stories as vertical slices, each with a short Implementation Context.
   Story 01 is the walking skeleton; check every story against INVEST.
5. Write each story's files at the shape its size calls for (Story File Contract).
6. Run `ai-flow archive --refresh` so `epics/INDEX.md` lists the new or changed epic.
7. Recommend the first story to run with `/flow-run`.

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

## Intent (in `index.md`)

Eight lines at most, above the Backbone, so every story is judged against the same
need instead of a long PRD:

```md
## Intent

- Problem: one concrete situation, not a category.
- Actors: who or what acts — a person, a calling service, a player, a peer, a device.
- Success signal: what someone can observe when it works.
- Appetite: how many stories this is worth (2–7).
- No-gos: what this epic will not do. Must not change: what already works and stays.
- Assumptions: at most three, each tagged value / usability / feasibility / viability
  and named by the story that tests it — the riskiest one by story 02.
```

Tag every product claim with where it comes from: `user-stated`, `repo-observed:
<path>`, `web-sourced: <url> <date>`, or `assumption`. Never invent personas, market
figures or "users want X": an untagged claim is an assumption.

## Walking Skeleton (Story 01)

Story 01 of a **new** epic is the thinnest slice that crosses every layer the epic
will touch — from its real entry point through the real logic to the real
persistence, wire or device — never a single-layer stub (a screen over no data path,
an endpoint nothing calls). Hardcode everything beyond that one path. The entry point
depends on the project:

| Project | Story 01 proves |
|---|---|
| Web or mobile app | one screen, even bare, backed by the real path |
| Service / API | one real request end to end, through the real store |
| CLI | argv → core → stdout and exit code, tested |
| Library / SDK | one public call, exercised by a test or doctest |
| Protocol / networking | two peers exchange one message over a real socket |
| Game | one playable tick of the core loop, greybox |
| Embedded | boot → one sensor read → one output, on target or emulator |
| Data / ML | ingest → transform → one metric against a baseline |

It is about integration, not size: a single-file QUICK story can be one. Once it
ships, the feature is alive end to end and every later story only enriches a working
path. **Stop condition:** if story 01 does not cross every layer, split or reorder
before writing story 02.

## Backbone (Story Order)

In `index.md`, a `## Backbone` section above `## Stories` names the journey the
stories walk in one line: `Backbone: browse → select a plan → pay → confirm` for a
product, `request → validate → store → notify` for a service, `connect → handshake →
exchange → close` for a protocol, `spawn → move → collide → score` for a game. Story
01 is the thinnest path across it; each later story deepens one step. Reordering a
story means moving it to another point on the journey, never just renumbering.

Each `## Stories` entry, in story order, is a link that opens the story's spec in the
editor — the folder name as link text, `spec.md` (or `story.md` for a single-file
story) as target, the outcome and mode after it:

```md
1. [story-NN-MM-name](story-NN-MM-name/spec.md) — <one-line outcome> *(MODE)*
```

Keep notes on order outside the list. `ai-flow doctor` warns on any other entry form
or a missing target; `ai-flow doctor --fix` rewrites the entry, keeping its text.

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
the fewest questions that prevent the most rework, in the user's language. **Read
before asking**: what the repo, the scan or the docs can answer is looked up, never
asked. Ask in **rounds of at most 4 questions** that walk the decision frontier: only
decisions whose answer changes implementation, the ones later answers depend on
first. Each question opens with its recommended answer, so "yes" or a pick settles
it. Stop when the next question would not change implementation; a round with
nothing that would is not asked. Budget: 5–15 questions, 10–20 for auth, migration,
billing, permissions or data modeling. The highest-value kinds — ask only those that
apply:

- Scope boundary — what is explicitly out?
- Actor/permission — who can do this, and who cannot?
- Data truth — where does the data come from, and who owns it?
- Failure mode — what happens when this fails?
- Platform and budgets — target runtime, toolchain, memory, latency, frame or
  real-time limits.
- Compatibility — wire format, public API or semver promises, existing callers.
- Determinism and packaging — reproducible output, how it ships and installs.
- UX decision (when there is a UI) — what does the user see at the decision point?
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

A story that fails Independent or Small is a split, not a note for later. The riskiest
assumption of the `## Intent` is tested by story 01 or 02, not discovered in story 05.

### Readiness Gate

When the questions stop, record a verdict against the stopping rule — *would the
next question change implementation?* — instead of sliding into writing:

- **`ready`** — no open question would change implementation. Write the stories.
- **`not ready`** — a blocking question is open. Write no stories (except the
  marker below): ask the highest-leverage follow-up, put the missing decision to
  the user as a labeled question, or cut scope until it no longer matters.
- **`stop`** — it should not be built, or not now: say why (already exists,
  assumption refuted, cost beyond the appetite). Write no stories.
- An epic that adds a module is **`not ready`** while its `## Boundaries` section is
  missing or has no `approved by:` name.
- A criterion that rests on a reading the user did not confirm, where another
  plausible reading changes observable behaviour, is confirmed or marked: the
  story is written, with a line that begins `Assumption (unconfirmed):` (after an
  optional `- `) naming the reading and the question; that story is not ready to
  run, the epic stays **`not ready`**, and its `## Readiness` lists the line as the
  blocking item. Accepting the recommendations ("go", "yes") counts as confirming
  them: record them as decisions. A headless run, where nobody can answer, stops at
  `not ready` with the question and never picks the answer. The rule holds whether
  or not Clarify First ran.

Record the verdict, and the blocking item when `not ready`, in the epic `index.md`.

## Brownfield Bootstrap (opt-in)

For an existing codebase, write durable project docs before any story. Application
code is not modified, and no epic is created unless the user asks.

1. Run `ai-flow bootstrap --scan --json` fresh (it is mechanical and takes
   milliseconds; a `docs/bootstrap-scan.md` may be stale), then read only the files
   needed to confirm framework, scripts, architecture, tests and conventions. If it
   says `"classification": "empty"` while the repo clearly holds code, the detectors
   (JS/TS, Go, Rust, Python and Java manifests) missed the stack — .NET, C/C++, a game
   engine, firmware: say so, and read the project directly.
2. Write current-state facts into `docs/project-context.md`, `docs/architecture.md`,
   `docs/conventions.md` and `docs/roadmap.md`: architecture, existing patterns,
   hardcoded data, coupling points, migration risks, the first safe vertical slice.
3. Summarize rather than dump the audit; mark uncertain findings as assumptions;
   keep human-written docs that are more specific.

## Foundations (new project or new module, opt-in)

Decide once what later stories must not drift from, and make a command hold it rather
than prose. One question: *what is this project's public surface?* Then:

| Surface | Artifact | Drift check (into `validation.quality`) |
|---|---|---|
| UI | short design tokens file (colors, type, spacing) | token lint, contrast check |
| Service / API | OpenAPI, protobuf, GraphQL SDL or AsyncAPI | `oasdiff breaking`, `buf breaking` |
| Data | versioned migrations | migration lint, migrate from empty |
| Library | public API snapshot | semver checker (API diff) |
| CLI | `--help` and `--json` output, exit-code table | snapshot tests |
| Protocol | state table and test vectors | vector tests, fuzzing |
| Game | one-page core loop (3–4 verbs) | headless loop tests |
| Embedded | RAM / flash budget | size check on the linker map |

Story 01 creates the artifact and wires its check. Like `## Boundaries`, the choice is
a human decision; the command is what enforces it. Keep the artifact small: a large
file loaded on every turn costs more than it saves.

Record the cross-cutting needs once, in `docs/project-context.md`, as ten short lines
— security level and auth model, data sensitivity, logs and traces, config and
secrets, i18n, accessibility target, performance, reliability, packaging and delivery,
test layers — each `yes`, `no` or `n/a` with one line of why and its check (or "review
only"). Decide now what is costly to retrofit; defer the numbers (SLOs, budgets) until
the skeleton can measure them.

## Research (opt-in, for a named unknown)

Research only answers a question the plan names (`NEEDS RESEARCH: which CRDT library
handles offline edits?`), never a general survey. Every fact carries its URL, the
supporting quote and the date, and goes into the story's `## Decisions` or a short
`## Sources` in `index.md`; a fact without them is an assumption. Keep what the
existing system does apart from what will be built, or the plan rebuilds what exists.
Look where the project type lives — RFCs, comparable libraries and their issues,
dataset cards, comparable games — and at the market only for a consumer or SaaS
product. If the user has their own research tool, write the prompt for it instead.

## Plan Review (opt-in, STRICT epics)

For an epic carrying STRICT stories, hand the request and the written plan — not this
conversation — to a fresh read-only reviewer: is it feasible against the code, are the
cited files, APIs and packages real, is any story too big, is the riskiest assumption
tested early? Fix what is wrong; a reviewer always finds something, so leave style
and taste alone.

## Verification

Before reporting the plan as done:

- [ ] Every file under `## Generated Files` exists on disk — checked, not assumed.
- [ ] `index.md` has an `## Intent` whose assumptions each name the story that tests
      them, and every product claim carries its source tag.
- [ ] Story 01 is a walking skeleton: end-to-end value on its own, not one layer.
- [ ] Every acceptance criterion is a `- [ ]` item in Given/When/Then form — prose
      criteria are invisible to `verify`.
- [ ] `ai-flow doctor` ran and reports no duplicate story numbering and no
      oversized epic.
- [ ] Every `## Stories` entry is `N. [story-…](story-…/spec.md)` (`story.md` for a
      single-file story) and the target exists — `doctor` reports no
      `story_entry_not_linked`.
- [ ] `ai-flow archive --refresh` ran after the epic was written or changed —
      `doctor` reports no `epic_index_stale`.
- [ ] Any dependency tree uses only the shapes above, and each edge is a real
      build-on relationship — checked, not assumed.
- [ ] An epic that adds a module carries `## Boundaries` with an `approved by:` name
      the user gave.
- [ ] No criterion rests on an unconfirmed reading that changes behaviour, unless
      its story has an `Assumption (unconfirmed):` line and the epic's
      `## Readiness` is `not ready` and lists it — whether or not Clarify First ran.
- [ ] No implementation happened: planning writes story files, `/flow-run` writes
      code.

A criterion with no observable outcome can be neither verified nor reviewed: rewrite
it here, where it is cheap.

## Output

`# Plan Result`, then these `##` sections in order: Epic (path, goal, scope),
Stories, First Story To Run, Generated Files, Assumptions (every `Assumption
(unconfirmed):` line, whether or not Clarify First ran), Risks, Clarification
Readiness (`ready` / `not ready` / `stop`, only when Clarify First ran), Recommended Next
Command (`Use /flow-run for …`).
