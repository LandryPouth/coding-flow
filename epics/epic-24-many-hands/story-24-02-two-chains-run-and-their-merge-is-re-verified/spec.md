# Story 24-02 — Two chains run and their merge is re-verified

## User Value

`run.maxParallel: 2` lets two independent chains of an epic run at once; when
each finishes, a local merge queue integrates them one at a time, re-runs
verify on the merged tree and has an independent reviewer look at the files
both chains touched — so the conflicts parallel work moves to the merge
(bethl epics 37/38 collided on shared files) are caught before they count.

## Requirements

- `run.maxParallel` default 1, refused above 2 unless
  `run.allowMoreParallel: true` (the maintainer's cap is 2).
- Chains: independent roots of the dependency tree (backbone.js); each in its
  own worktree (20-02, 24-01).
- Merge queue (local, sequential): a finished chain enters the queue; the
  queue merges it into the epic branch in a scratch worktree, runs verify on
  the merged tree (all required tiers), and when the other chain already
  landed and both touched common files, runs a read-only review process on
  those files (findings recorded, scope `crossing`).
- Green + no open P0/P1 → the merge is fast-forwarded onto the epic branch.
  Red or open P1 → the later chain is parked (`blocked (merge)`), never the
  earlier; the run continues with what remains.
- The 19-03 machine queue still applies: two verifies never run at once on
  the machine.
- Events `queue.enter`, `queue.merge`, `queue.park`.

## Acceptance Criteria

- [ ] Given `maxParallel: 3` without the allow flag, then the run refuses.
- [ ] Given two independent roots, then both chains start and run in separate
      worktrees.
- [ ] Given both chains touching one file, when the second integrates, then a
      crossing review runs on that file.
- [ ] Given a merged tree that fails verify, then the later chain is parked
      and the epic branch is unchanged.
- [ ] Given a green integration, then the epic branch advances and the scratch
      worktree is removed.

## Edge Cases

- A textual merge conflict: the later chain parks with the conflicting files
  (reuse `conflictingFiles`).
- Driver crash mid-queue: resume (20-06) restarts the integration from
  scratch.

## Out of Scope

- More than one machine (24-03).

## Security

- Unattended merges only into the epic branch, never into the base or main;
  promotion stays `land`/PR (24-04).
- Verify on the merged tree is the CLI's, never the agents'.
