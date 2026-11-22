# Story 28-01 — Ideas from the repo

## User Value

A maintainer who has finished everything planned runs `ai-flow next` and,
instead of "nothing to run", reads up to three things the repository itself
says could come next — each with where it comes from and its size — and can
plan, park or kill each in one command.

## Requirements

- **Ledger.** `docs/ideas.md`, created on first write, one line per idea:
  `- [<status>] <what> — why: <one line> — source: <kind>:<ref> — size: story|epic — id: <id>`
  - `status`: `proposed`, `planned → <epic path>`, `parked`, `killed: <reason>`.
  - `kind`: `deferred` (story path + criterion), `assumption` (epic path),
    `roadmap` (file:line), `later` (epic index path + item), `marker`
    (file:line), `user-stated` (date), `repo-observed` (path, 28-02).
  - `id`: short, derived from the normalized source, stable when the text is
    reworded.
- **Scan** (`ai-flow ideas scan`, also run by `next` when it needs it; no
  model, no network):
  - `- [~]` criteria and `## Deferred Criteria` items of done stories;
  - `Assumption (unconfirmed):` lines (story 16-01's marker: a line of a story
    file that begins with it, canonical, and the same line listed under the
    epic index's `## Readiness`), each idea counted once;
  - unchecked `- [ ]` lines of `docs/roadmap.md`;
  - items under `Out of scope`/`Later`/`Hors périmètre`/`Plus tard` headings
    of landed epics' indexes;
  - code lines matching `ideas.markers` (config, default empty; bethl sets
    `["À venir", "not yet produced", "Pas encore produit"]`), outside tests
    and generated code.
  New candidates are appended `proposed`; existing ids (any status) are
  never re-added.
- **`next` Ideas block.** Printed only when no tier yields a command (below
  the 26-07 We need you block if any): three `proposed` ideas at most,
  ordered roadmap → deferred → assumption → later → marker, then oldest
  first; one line each (`<id> <what> (size) — <kind>`), then
  `ai-flow idea plan <id>` as the suggested command. `--json` adds `ideas`.
- **Commands.** `ai-flow idea plan <id>` marks `planned` and prints the
  `/flow-plan` prompt to paste (idea text + source); `park <id>`;
  `kill <id> "<reason>"` (reason required); `ai-flow ideas` lists all with
  status.
- **Never more.** No idea is shown while a story has something to run; no
  idea without a source; no automatic planning.

## Acceptance Criteria

- [ ] Given a repo with one `[~]` criterion, one `Assumption (unconfirmed)` and two unchecked roadmap lines, when `ai-flow ideas scan` runs, then `docs/ideas.md` holds 4 `proposed` lines, each with `source:` and `id:`.
- [ ] Given the scan run twice, when the second run ends, then `docs/ideas.md` is unchanged.
- [ ] Given an idea killed with a reason, when its source is rescanned, then it is not re-added and `next` never shows it.
- [ ] Given a planned story with a command to run, when `ai-flow next` runs, then no Ideas block is printed.
- [ ] Given no story left to run and 5 proposed ideas, when `ai-flow next` runs, then it prints exactly 3, roadmap first, and suggests `ai-flow idea plan <id>`.
- [ ] Given `ai-flow idea kill <id>` without a reason, when it runs, then it exits non-zero and changes nothing.
- [ ] Given `ideas.markers: ["À venir"]` and a schema comment containing it, when the scan runs, then a `marker` idea points at that file:line; the same text in a test file is ignored.
- [ ] Given `next --json` with ideas shown, then the output has an `ideas` array with id, what, size, source.

## Edge cases

- A ledger edited by hand (reordered, reworded): ids still match by source.
- An idea whose source disappears (criterion now ticked): stays in the
  ledger, marked `proposed` but not shown (`stale` in `ai-flow ideas`).
- No `docs/` directory: the ledger is created with it.

## Out of scope

- Ranking by value, ideas from reading code (28-02).
