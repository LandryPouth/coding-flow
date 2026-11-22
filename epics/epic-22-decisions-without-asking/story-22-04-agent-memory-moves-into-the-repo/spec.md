# Story 22-04 — Agent memory moves into the repo

## User Value

The project rules that live in one person's agent memory — on bethl about 30
Claude memory files: "land = local merge", "never the main checkout", "2
stories max in parallel", "never create test accounts", "UI sober, one
accent", "shadcn first" — move into the repository one approved item at a
time, as `autonomy.md` rows, conventions or decisions, so a teammate's agent
and other projects see them (bethl DOGFOODING bilan, P1).

## Requirements

- `/flow-retro --memory` (extends 21-05's skill): reads the user's agent
  memory directory for this project, classifies each entry `project` (about
  this repository) or `personal` (one person's taste), and for each `project`
  entry drafts a target: an `autonomy.md` row, a `docs/conventions.md` line,
  or a `decisions.jsonl` entry with provenance `agent-memory`.
- One item at a time: each draft is shown with its source and target; the
  human accepts, edits or skips; accepted items are written to the repo; the
  memory file is left untouched (the human may delete it).
- `personal` entries are never proposed.
- Dogfooded on bethl: the run's result lists what moved and what stayed.

## Acceptance Criteria

- [ ] Given a fixture memory directory with one project and one personal
      entry, when the skill runs (eval), then only the project entry is
      proposed.
- [ ] Given an accepted `land = local merge` entry, then it becomes a policy
      or convention line in the repo with provenance.
- [ ] Given the skill, then it never edits or deletes memory files.
- [ ] Given bethl (manual, recorded in `## Result`), then the moved items and
      the kept personal ones are listed.

## Edge Cases

- A memory that contradicts an existing repo rule: proposed as a superseding
  decision, shown side by side, never silently overwritten.

## Out of Scope

- Precedence between personal and project rules for teams (24-06).
