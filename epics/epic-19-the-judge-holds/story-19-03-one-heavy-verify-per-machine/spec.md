# Story 19-03 — One heavy verify per machine

## User Value

Two verifies started from two checkouts, or a verify started while a dev
server eats the memory, no longer kill each other: a heavy verify waits for
the machine, says why, and starts when the previous one ends and enough
memory is free. bethl lost runs to memory kills (exit 143) with ~2–5 GB free
on a 14 GB WSL machine while `next dev` held 5.5 GB.

## Requirements

- A verify is heavy when its commands include a test command (by the same
  classification `verify` already uses, or any command not tagged `fast` once
  19-06 tiers exist).
- A machine-wide lock file under the user cache dir
  (`$XDG_CACHE_HOME/coding-flow/verify.lock`, fallback `~/.cache/…`) held for
  the duration of the heavy commands, with pid, checkout, story, start time.
  Stale lock (dead pid) is taken over and reported.
- Memory gate: before starting, `os.freemem()` (and on Linux
  `MemAvailable` from `/proc/meminfo`) must be ≥ `verify.minFreeMemoryMb` in
  `harness.json` (default 3072). Otherwise wait, polling every 15 s, printing
  one line per minute: who holds the lock / how much memory is free.
- `verify.maxWaitMinutes` (default 30): past it, the verify ends with a tool
  error `machine busy` (not a red), so a driver can retry later.
- The wait time is recorded in the evidence and in `verify.start`.
- `--no-queue` opts out for a single run.

## Acceptance Criteria

- [ ] Given a lock held by a live process, when a second heavy verify starts,
      then it waits and prints the holder, and starts after the holder ends.
- [ ] Given a lock whose pid is dead, then it is taken over with a notice.
- [ ] Given free memory below the threshold, then the verify waits; given it
      stays below for `maxWaitMinutes`, then it ends as a tool error, not a
      red.
- [ ] Given a verify with only fast commands, then it neither waits nor takes
      the lock.
- [ ] Given a completed queued verify, then its evidence records the wait.

## Edge Cases

- Windows/macOS: `os.freemem()` only; the lock path follows the platform
  cache dir.
- Nested verify (a verify spawning verify in tests): the lock is re-entrant
  for the same pid tree via an env marker.

## Out of Scope

- A daemon or a service (design-decisions entry 2); cross-machine queues.
