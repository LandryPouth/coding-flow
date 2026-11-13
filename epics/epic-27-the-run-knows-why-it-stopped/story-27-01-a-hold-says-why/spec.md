# Story 27-01 — A hold says why

## User Value

Every story that is not moving says why, who must act and with what
command, in one form read by `status`, `todo`, `run --watch`, the report and
notifications: `waiting`, `paused`, `failed`, `needs-decision`, `parked`,
`skipped`, `error`, or `stopped` at run level (orchestration.md §1).

## Requirements

- Hold record in the run state: reason, sub-reason, owner (`agent` /
  `human` / `machine`), next command, since, resume condition. Event
  `hold.set` / `hold.clear` in the journal; the run state is rebuilt from
  the journal when the two disagree.
- The CLI writes `## Status: blocked` plus `Hold: <reason>[: <sub>] — <owner>
  — <next command>` in the story; the guard denies a `Hold:` line written
  by a driven agent (as for `## Status`).
- Existing planned states map onto holds: `blocked (needs you)` (20-05) →
  `needs-decision`; `blocked (merge)` (24-02) and `blocked (base merge)`
  (24-07) → `parked`; budget and `stopAfterBlocked` stops → `stopped`;
  machine busy (19-03) → `waiting: verify-slot`.
- `ai-flow status` shows the hold next to the story; `next` ranks
  `needs-decision` and `failed` first, never `waiting`.

## Acceptance Criteria

- [ ] Given a story red after its attempts, then its file has `## Status:
      blocked` and `Hold: failed — human — <command>`, and `status` shows it.
- [ ] Given a driven agent writing a `Hold:` line, then the guard denies it.
- [ ] Given a story waiting for a verify slot, then its hold is `waiting:
      verify-slot`, owner `machine`, and `next` does not rank it.
- [ ] Given a deleted state file, when the run resumes, then holds are
      rebuilt from the journal.
- [ ] Given any hold, then it has a next command (a hold without one fails
      a test).

## Out of Scope

- Notifications (27-07); packets (27-06).
