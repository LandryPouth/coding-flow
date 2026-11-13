# Story 27-05 — A run is previewed and stopped cleanly

## User Value

Before leaving a run alone, the maintainer sees what it will do; when they
need it to stop, it stops cleanly and can resume.

## Requirements

- `run --plan` (no process started): chains, order, slots, stories that
  will not run and why (owner human, not ready, held), budget caps, and
  cost and duration estimates from past runs when epic 21 history exists.
- `run --stop`: no new phase starts; running phases finish; run
  `stopped: requested`.
- `run --abort`: process groups killed, slots and locks released, phases
  `error`, run `stopped: aborted`; resumable (27-03).

## Acceptance Criteria

- [ ] Given an epic, when `run --plan` runs, then it prints the schedule and
      starts nothing.
- [ ] Given a story owned by `human`, then `--plan` lists it as not run and
      why.
- [ ] Given `run --stop` during an implement phase, then the phase finishes
      and nothing new starts.
- [ ] Given `run --abort`, then no child process survives and every slot and
      lock is released.
