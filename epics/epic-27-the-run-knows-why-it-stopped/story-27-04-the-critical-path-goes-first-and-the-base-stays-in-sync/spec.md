# Story 27-04 — The critical path goes first and the base stays in sync

## User Value

The story with the most work behind it starts first, and a base that moves
during a long epic is merged in between stories, so a conflict shows up when
it is small instead of at the land.

## Requirements

- Scheduler: among startable stories, order by remaining dependents
  (longest path to a leaf), then story order.
- `run.syncBase: between-stories | at-land` (default `between-stories`):
  between two stories of a chain, if the base moved, merge it into the
  chain branch, run verify on the stories done so far; green → continue;
  conflict or red → the epic is `parked: base-sync` with the files, the run
  continues other chains.
- The sync never rewrites history (merge, not rebase) and never touches the
  base itself.

## Acceptance Criteria

- [ ] Given two startable stories, one with three dependents and one with
      none, then the first starts first.
- [ ] Given the base moved during a run, when a story finishes, then the
      base is merged into the chain branch and verified before the next.
- [ ] Given that merge conflicting, then the chain is `parked: base-sync`
      with the files and the base is unchanged.
- [ ] Given `syncBase: at-land`, then no merge happens mid-run.

## Security

- Merges only into chain/epic branches; the base and `main` are read-only to the run.
