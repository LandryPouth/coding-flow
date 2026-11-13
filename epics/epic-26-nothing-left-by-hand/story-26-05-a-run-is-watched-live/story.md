# Story 26-05 — A run is watched live

*(FAST — read-only view over the run state and events.)*

`ai-flow run --watch [<runId>]` (latest live run by default) refreshes every
2 s: each chain and its story phase, who holds each agent slot and verify
slot, what waits and why (verify queue, usage-limit pause until, serial
path), cost so far against the caps, the last 5 events. `--once` prints one
frame (for agents and scripts); `--json` prints the state. Plain text, no
dependency; quits on `q` or Ctrl-C without touching the run.

## Acceptance Criteria

- [ ] Given a live run with two chains, when `run --watch --once` runs, then
      it prints both chains with their phases and the slot holders.
- [ ] Given a run paused on a usage limit, then the frame says until when.
- [ ] Given no live run, then it says so and exits 0.
- [ ] Given `--json`, then the output parses and matches the state file.

## Commands

```bash
npm test
```

## Result
