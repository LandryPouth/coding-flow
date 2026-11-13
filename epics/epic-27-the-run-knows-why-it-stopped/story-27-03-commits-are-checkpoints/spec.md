# Story 27-03 — Commits are checkpoints

## User Value

A crash, a lost state file or a killed terminal never makes the run redo
work that already reached git, and never trusts work that did not
(orchestration.md §3).

## Requirements

- Every commit made by a driven process carries the trailer
  `Coding-Flow-Run: <runId>/<story>/<phase>/<attempt>` (the driver sets it
  through a `prepare-commit-msg` hook installed for the run, or the
  agent's commit template; verified in this story).
- Resume reads `git log --format=%(trailers)` on each chain branch: a
  phase with a trailer commit and a green verify on that tree is done; a
  phase with uncommitted changes and no trailer restarts from its start
  after stashing them under a named stash reported in the run.
- `run --resume` works with no state file at all, from git and the journal.

## Acceptance Criteria

- [ ] Given a driven commit, then it has the trailer with run, story, phase
      and attempt.
- [ ] Given the state file deleted after a story's implement phase
      committed, when the run resumes, then implement is not rerun.
- [ ] Given uncommitted changes from a killed phase, then they are stashed
      under a named stash, reported, and the phase restarts.

## Security

- The hook installed for the run is removed at run end and never overwrites a project hook (chains to it).
