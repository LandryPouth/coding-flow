# Story 18-05 — Gates, status and worktrees leave events

## User Value

Every moment the tool already decides something leaves a line: a gate fired
and what was done about it, a story's status changed and on what proof, a
lock taken or released, a worktree placed, landed or removed. With 18-01 and
18-04, the journal now holds the whole life of a story, which is what epic 21
measures and epic 20 resumes from.

## Requirements

- `gate.fired`: gate (`coverage`, `contrary`, `criteria`, `plan-commands`,
  `claim`, `red-at-base`…), verdict effect, and — on the next verify of the
  same story — the outcome inferred: `test-added` (a test file joined the
  diff), `exempted` (a `## Test Exemption` appeared), `policy-changed`,
  `still-blocked`, or `abandoned` (no further verify within the run).
- `story.status`: from → to (as `status` derives it) with the proof it rests
  on (evidence file or `written`), emitted by commands that change it
  (`verify`, `review capture`, the driver later), never by `status` itself
  (a reader must not write).
- `worktree.place`, `worktree.lock`, `worktree.unlock`, `worktree.land`
  (merged commit, carried files, post-land verify result),
  `worktree.remove`, `worktree.conflict` (file list).
- `verify.killed` when a command dies by signal or timeout, with the cause
  (19-01 refines it).
- Every event is emitted where the fact is observed, via `appendEvent`.

## Acceptance Criteria

- [ ] Given a verify that ends NOT PROVEN by the coverage gate, when a test is
      added and verify reruns green, then the journal holds `gate.fired` and
      an outcome `test-added` for that story.
- [ ] Given a `## Test Exemption` added after a gate fired, when verify reruns,
      then the outcome is `exempted` with the reason's first line.
- [ ] Given `worktree lock`, `unlock`, `land` and `remove`, when each runs,
      then the matching event is appended once, with the story and branch.
- [ ] Given a land with conflicts, then `worktree.conflict` lists the files.
- [ ] Given `ai-flow status`, when it runs, then the journal is unchanged.

## Edge Cases

- A lock that outlived its story (coding-flow DOGFOODING 2026-11-10 *worktree
  lock*): the unlock event records the holder's status at unlock time, which
  21-01 can count.
- Events from a dry run: none.

## Out of Scope

- Metrics (epic 21); decision events (22-01); human turns (21-05).
