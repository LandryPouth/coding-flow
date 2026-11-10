# Story 17-02 — The index lists every epic, live and archived

## User Value

An agent or a human opens one file, `epics/INDEX.md`, and sees every epic and
every story the project has had: what is in progress and what was finished
and archived. They don't walk 15 directories, and they don't learn that an
archived epic ever existed only by luck.

## Requirements

- **The live section** lies between `<!-- coding-flow:index:start -->` and
  `<!-- coding-flow:index:end -->` and is generated from `listEpics`. One
  heading per epic gives its number, title and directory. Under it, each
  story gets one line with its number, its title and the **written**
  `## Status:`, or `—` when none is written. A line in the section says that
  the proof-derived state comes from `ai-flow status`.
- **The archived section** (story 17-01) is never regenerated; only the
  command appends to it.
- **Refresh.** `ai-flow archive --refresh` rewrites the live section only,
  with `--dry-run`. `archive <epic>` refreshes it too.
- **Doctor.**
  - `ai-flow doctor` warns `epic_index_stale` when the live section differs
    from what would be generated, or when `epics/` holds epics and has no
    index. The warning names the fix.
  - `doctor --fix` runs the refresh. Text outside the markers is never
    touched.
- **`/flow-plan`.** After writing or changing an epic, run `ai-flow archive
  --refresh`. One line in the Pipeline, and one in `## Verification`. Then
  update `evals/cases/flow-plan.json` and run `plugin sync`.

## Acceptance Criteria

- [ ] Given a temp repository with two epics, when `ai-flow archive
      --refresh` runs, then `epics/INDEX.md` lists both, with every story's
      number, title and written status, between the markers.
- [ ] Given that file, when it is refreshed again with nothing changed, then
      it is byte-identical (idempotent).
- [ ] Given hand-written text above the markers and an archived section
      below them, when it is refreshed, then both are byte-identical
      afterwards.
- [ ] Given a story added after the last refresh, when `doctor` runs, then
      it warns `epic_index_stale`. After `doctor --fix`, the warning is gone.
- [ ] Given a story whose proof went stale and whose written status did not
      change, when `doctor` runs, then it does not warn `epic_index_stale`.
- [ ] Given `--dry-run`, then the new section is printed and nothing is
      written.
- [ ] Given `flow-plan/SKILL.md`, then the Pipeline and `## Verification`
      name `ai-flow archive --refresh`, and the skill evals pass.

## Edge Cases

- A project with no `epics/` gets no index and no warning.
- A Spec Kit project (the story locator) is out of scope for the index. Its
  features are not epics, so they are not listed.
- A title with markdown or a `|` character is written as text. The format is
  a list, not a table, so nothing needs escaping.

## Out Of Scope

- Proof-derived status in the file.
- A separate `index` command (it is a flag on `archive`, to keep the front
  door small).
