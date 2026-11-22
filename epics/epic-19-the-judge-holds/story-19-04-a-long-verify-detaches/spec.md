# Story 19-04 — A long verify detaches

## User Value

An agent starts `ai-flow verify --detach`, gets a job id at once, and later
asks `ai-flow verify --wait <id>` or `--status <id>`. A 5–20 minute suite no
longer outlives the agent tool's timeout (bethl: killed at 590 s, exit 143),
and a worker no longer stalls waiting for a notification that never comes
(39-01 worker: "no progress for 600s").

## Requirements

- `verify --detach [--story …]` spawns a detached child running the same
  verify, writes `.coding-flow/jobs/<id>.json` (pid, story, started, log
  path, state) and prints the id and the log path; exit 0 immediately.
- `verify --status <id>` prints state (`queued` — waiting on 19-03 —,
  `running`, `done`, `failed`, `lost` when the pid is gone with no result)
  and, when done, the verdict line and evidence file.
- `verify --wait <id> [--timeout-min N]` blocks until done (or the timeout,
  exit code distinct from red), then prints the verify summary and exits with
  verify's exit code.
- A job whose tree changes while running is marked `superseded` at the end
  (its evidence still written, with the note) — bethl: "un run rendu caduc par
  une modification est annulé proprement".
- `verify --cancel <id>` kills the job's process group and marks it
  `cancelled`.
- Jobs older than 7 days are pruned from `jobs/` on the next detach.

## Acceptance Criteria

- [ ] Given `verify --detach`, when it returns, then it exits within 2 s with
      an id, and the job file says `running` or `queued`.
- [ ] Given a finished job, when `--wait <id>` runs, then it exits with the
      same code verify would have and prints the summary.
- [ ] Given a job whose process died without a result, then `--status` says
      `lost`.
- [ ] Given a commit during the job, then the job ends `superseded`.
- [ ] Given `--cancel <id>`, then the process group is gone and the job says
      `cancelled`.

## Edge Cases

- Detached child on Windows: `spawn` with `detached: true` and `windowsHide`.
- Two `--wait` on the same id: both read the job file; no race.

## Out of Scope

- Remote runners (24-05).
