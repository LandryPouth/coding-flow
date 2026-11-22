# Story 22-09 — A rule nobody needs is retired

## User Value

The rules an agent reads only grow: every friction and every repeated
finding can add a line, and nothing ever takes one away. The longer the list,
the less each line is followed. This story makes the ladder (22-03) work in
both directions: a convention a check now enforces, or that no finding or
friction has cited for a long time, is proposed for retirement — and the human
removes it, or keeps it with a reason.

## Requirements

- `ai-flow ladder --retire` (machinery) lists retirement candidates from
  the rungs 22-03 detects in the repo:
  - **superseded:** a convention line whose category also has a `check` or
    `gate` rung — the check enforces it, the prose only repeats it;
  - **dormant:** a convention line with no finding and no friction (22-08)
    in its category over the last N closed epics (default 5, set in
    `harness.json` as `ladder.dormantEpics`).
- Each candidate shows the line, its file, the commit that added it, and why
  it is a candidate (the check that supersedes it, or the epics it was
  silent through).
- `ai-flow ladder propose --retire <category>` writes
  `.coding-flow/proposals/retire-<category>.md` with the line to remove and
  its evidence. Nothing else changes.
- The human accepts by deleting the line (the ladder records
  `ladder.retired` with the commit) or keeps it by adding the marker
  `<!-- keep: <reason> -->` next to it, after which it is never proposed again
  until the reason is removed.
- A convention line without a category marker is listed as `untracked` once,
  so the human can tag it or leave it; it is never proposed for retirement.

## Acceptance Criteria

- [ ] Given a convention line and a gate config for the same category,
      then `ladder --retire` lists it as `superseded` with the gate named.
- [ ] Given a convention line whose category has no event in the last 5
      closed epics, then it is listed as `dormant`; with one event in the
      fifth, it is not.
- [ ] Given `ladder propose --retire`, then the proposal file exists and no
      other file changed.
- [ ] Given the line deleted by a commit, then a `ladder.retired` event
      records the commit; given a `keep:` marker, then the line is no longer
      listed.
- [ ] Given a project with fewer than N closed epics, then no line is
      `dormant` (not enough history to say).

## Edge Cases

- `AGENTS.md` and `docs/conventions.md` are both read; a line in a file the
  project did not write (generated, vendored) is skipped.
- Only an epic that is closed counts towards the dormant window.

## Out of Scope

- Deleting any line automatically.
- Retiring skill lines or checks: a check costs nothing to read; only prose
  is proposed for removal.
