# Epic 26 — Nothing left by hand

## Goal

What the maintainer still does by hand around a run is done by the tool:
review findings travel to the stories they concern, the run reaches the
maintainer when it needs them and lists everything waiting on them, the
docs are checked against the code, an epic closes itself (closure notes,
project context, land on a moved base), a live run can be watched, and
every rule's effective value can be printed with its source.

## Why

An inventory on 2026-11-13 of what the maintainer and the orchestrating
session did by hand on bethl epics 37–40, mapped against epics 18–25. Most
of it is planned; these six are not:

- **Findings carried by hand.** Every implementer brief on epic 40 was
  written with "risks inherited from previous reviews"; the epic 20 cleanup
  note already flags it as a loss if the native run drops it.
- **The maintainer is told by watching.** Progress, `Needs you`, a paused or
  blocked run reach them only if they look; their to-dos (RELIABILITY_SINCE,
  domain, FIDO2 keys) live in epic indexes and agent memory and are recalled
  by hand. Epic 24 defers notifications to Slack "later".
- **Docs drift unseen.** bethl's docs carried old Render values and stale
  paths until the maintainer noticed (2026-11-13: a 59-file docs refresh).
- **Epic closure by hand.** Merging the moved base, re-verifying, the
  closure note, `project-context.md`, land, worktree removal: done by the
  orchestrator for every bethl epic.
- **No live view.** A run's state is a file; the session that launched it
  polled.
- **Rules discovered by surprise.** `docs/rules-and-limits.md` (2026-11-13)
  found a default defined twice and settings honoured but never written.

Freeze: within the factory exception (design-decisions entry 15).

## Scope

**In scope**

- Open risks in the run state, handed to later stories and the report.
- A notify command in the user's config; `ai-flow todo`.
- `ai-flow docs check` (paths, scripts, links) and docs proposals at closure.
- Epic closure: notes, project context, changelog, base merge re-verified,
  land, cleanup.
- `ai-flow run --watch`.
- `ai-flow rules` from one registry; the code inconsistencies of
  `docs/rules-and-limits.md`.

**Out of scope**

- Slack/email routing by owner (24-06).
- Writing product docs from scratch: only drift and closure updates.
- Pushing or deploying: land stays local or a PR (24-04).

## Backbone

`Backbone: findings travel to the next story → the run tells you what it needs → the docs are checked against the code → the epic closes itself → a run is watched live → the rules are printed with their source`

```text
s1

s2

s3
└── s4

s5

s6
```

s4's closure runs s3's docs check on the files the epic changed. The others
touch disjoint modules (run state, notify/todo, run watch, rules registry).

## Stories

1. **story-26-01-findings-travel-to-the-next-story** *(STANDARD)*
2. **story-26-02-the-run-tells-you-what-it-needs** *(STANDARD — runs a user-declared command)*
3. **story-26-03-the-docs-are-checked-against-the-code** *(STANDARD)*
4. **story-26-04-the-epic-closes-itself** *(STRICT — merges into the base)*
5. **story-26-05-a-run-is-watched-live** *(FAST)*
6. **story-26-06-the-rules-are-printed-with-their-source** *(STANDARD)*

## Decisions

- **The notify command is the user's, never the repository's**: a cloned
  repo must not make anyone run a command.
- **Docs check is mechanical first**: paths, scripts and links can be
  checked without judgment; meaning drift is left to the closure process,
  which only proposes.
- **Closure drafts, the land shows**: project context and roadmap edits are
  committed on the epic branch as one docs commit and listed in `REPORT.md`;
  the maintainer reads them before the land when `land: pr`, after when
  `land: local` (revert is one commit).
- **One rules registry**: every default, cap and source in one module; the
  doc is checked against it by a test, so it cannot drift either.

## Dependencies outside this epic

Epic 20 (driver, run state 20-06, reviews 20-04, report 20-07), epic 24 s1
(`land --epic`, serve) and s7 (base queue), epic 18 (events).

## Delivery order

s3 and s6 need nothing from the factory and can ship early, alongside
epics 18–19. s1, s2 and s5 follow epic 20; s4 follows 24-07.

## Readiness

`ready`.
