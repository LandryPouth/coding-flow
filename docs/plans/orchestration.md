# Orchestration — how a run waits, fails, succeeds and calls a human

Status: design, 2026-11-13. Delivered by epic 27 (*The run knows why it
stopped*), on top of epic 20 (driver) and before epic 24 (parallel work).
Values live in [`docs/rules-and-limits.md`](../rules-and-limits.md).

## Why

The planned run had one word for four different situations. "Blocked" meant
tests red after the attempts, a question waiting for the maintainer
(`blocked (needs you)`), a merge that failed (`blocked (merge)`,
`blocked (base merge)`), and a budget stop. Each has a different cause, a
different owner and a different next action, and nothing in a story's state
said which, whether it would resume by itself, or who should act. The
report, `todo`, `--watch` and notifications could not be right without it.

## 1. Three axes, never mixed

| Axis | Lives in | Values |
|---|---|---|
| **Lifecycle** (durable) | the story (`## Status`) and the journal | `planned → ready → running → proven → reviewed → done → integrated → landed` (`released` is human only) |
| **Phase** (ephemeral) | the run state | `implementing`, `verifying`, `reviewing`, `confirming` (skeptics), `fixing`, `closing`, `integrating` |
| **Hold** (why it is not moving) | the run state, mirrored to a `Hold:` line in the story | the table below |

`## Status` keeps today's values (`planned`, `in-progress`, `done`,
`blocked`) for compatibility; a held story writes `## Status: blocked` and a
`Hold: <reason> — <owner> — <next command>` line, written by the CLI only.

### Hold reasons

| Reason | Meaning | Owner | Resumes |
|---|---|---|---|
| `waiting` | context not ready: dependency, agent slot, verify slot, free memory, serial path, dirty primary checkout | machine | by itself, on its condition |
| `paused` | a window is closed: usage limit, budget near its cap | machine (budget: human) | by itself when the window reopens; budget on `run --resume` |
| `failed` | the work was tried and failed: red after the attempts, P0/P1 open after the fix pass | human (triage) | after a change, `run --resume` |
| `needs-decision` | a human decision is missing: product question, finding marked user-decides | human | on `ai-flow answer`, or by a timed decision (§5) |
| `parked` | integration failed: textual conflict, merged tree red | human or a rebase agent | after resolution |
| `skipped` | a dependency is not done | — | when the dependency is done |
| `error` | the tool could not observe (harness tool error, agent process died before reporting) | machine | retried; never counts as a failure |
| `stopped` *(run level)* | budget exhausted, circuit breaker, `run --stop` | human | `run --resume` |

Every hold carries: reason, sub-reason (e.g. `waiting: verify-slot`),
owner, next command, since (timestamp), and the resume condition when there
is one. A hold without a next command is a bug.

### One source of truth

Every transition is an event in `.coding-flow/events.jsonl` (epic 18) with
run, story, phase and attempt ids. The run state, `status`, `todo`,
`run --watch`, `REPORT.md` and notifications are projections of the
journal; none keeps its own truth, so they cannot disagree.

## 2. Failure taxonomy

Every failure is classified before anything is retried.

| Cause | Detected by | Counts as an attempt | Response |
|---|---|---|---|
| Red test from the change | verify red, test names (19-01) | yes | reflective retry (20-03), at most `run.attempts` |
| Flaky test | 19-02 noise classification | no | re-run once; quarantine proposal (epic 23) |
| Transient network or API error | process exit, error subtype | no | up to 3 retries, backoff 30 s → 5 min |
| Usage limit, 429 | error subtype | no | `paused` (20-03) |
| Model overloaded | error subtype | no | `--fallback-model` for light roles only (skeptic, walker, critic, report); strong roles wait |
| Timeout or stall | wall clock, no progress (20-03) | yes | process killed, retried |
| Guard denial | guard log | yes, flagged | second denial in one story → `failed` with a security note, no blind retry |
| P0/P1 open after the fix pass | review capture | — | `failed (review)` |
| Ambiguous spec | agent writes `## Needs you` | no | `needs-decision` |
| Environment broken | circuit breaker (below) | no | `stopped (environment)` + diagnosis |
| Budget | caps (20-06) | — | `paused` at 80 % of the run cap if `run.budgetPauseAt` is set, else `stopped` at the cap |

### Circuit breaker

`run.stopAfterBlocked` (three consecutive) cannot tell three bad stories
from one broken machine. The breaker trips when:

- two different stories fail on the same command or the same test name;
- two failures are classified `environment` (DB unreachable, missing
  module, port in use, out of memory);
- a pre-story health check fails (`run.healthCheck`: the project's own
  command, e.g. DB ping + packages built).

On trip: no new story starts, running phases finish, one read-only
diagnosis process writes what it found into the report, the run is
`stopped (environment)` with urgent notification. Stories caught by it are
`error`, not `failed`, and keep their attempts.

## 3. Idempotence and scheduling

- **Commits are checkpoints.** Every commit a driven process makes carries
  a trailer `Coding-Flow-Run: <runId>/<story>/<phase>/<attempt>`. Resume
  reads git as well as the state file: work that reached git is not redone,
  even if the state file was lost.
- **Every phase is restartable from its beginning** (20-06) and must leave
  nothing half-done that the restart cannot see (no uncommitted edits
  carried across phases; the phase commits or discards).
- **Finish before start** (24-02 slot priority).
- **Critical path first**: among startable stories, the one with the most
  dependents (longest remaining path) gets the next chain slot.
- **Base sync**: `run.syncBase: between-stories | at-land` (default
  `between-stories`): the moved base is merged into the epic branch between
  two stories, verified, and a conflict parks the epic early instead of at
  the land.
- **Preview**: `run --plan` prints the schedule (chains, order, slots), the
  stories that will not run and why, and an estimate of cost and duration
  from past runs (epic 21) — the last checkpoint before the human leaves.
- **Stopping**: `run --stop` (finish current phases, then `stopped`),
  `run --abort` (kill process groups, release slots and locks, state
  `stopped (aborted)`), both resumable.

## 4. Success has rungs

A story reports how far it got and how sure the proof is:

- rung: `proven`, `reviewed`, `done`, `integrated`, `landed`;
- coverage: `verified` / `evidence` / `exempted`;
- review: independent process, lenses, skeptics refuted;
- browser: observed / open;
- **debt**: accepted P2s, open risks (26-01), unobserved browser items.

"Done with debt" is shown as such in `status`, the report and the landing
notification; it is never displayed as a clean success.

## 5. The human

### Decision packets

A question reaches the maintainer as a packet, not prose: context (two
lines), 2–4 options, the recommended one, the consequence of each, the
story and what waits on it. Answered in the story file (tick an option) or
with `ai-flow answer <story> <option>`.

### Timed decisions

When `autonomy.md` (epic 22) allows it for the topic, a packet unanswered
after `decide.afterHours` (default: never) takes the recommended option,
marked `Assumption (unconfirmed)` (16-01) and listed in the report. Never
for anything irreversible (migrations dropping data, production, money,
permissions).

### Notifications

| Level | Events | Delivery |
|---|---|---|
| Urgent | `needs-decision` blocking every chain, run `stopped`, circuit breaker, security flag | immediately; reminded once after `notify.remindAfterHours` (default 4) |
| Info | story done (with debt flag), epic integrated or landed | batched, at most one per `notify.batchMinutes` (default 30) |
| Digest | the day's runs, holds, cost | `notify.digest: daily` or at run end |

Quiet hours (`notify.quiet: "22:00-08:00"`) hold everything but urgent.
Duplicates are dropped. Each message carries one command to act. The
command itself is the user's (26-02), never the repository's.

## 6. Measuring the waits

Each story records time per lifecycle state, phase and hold reason. The
report and `insights` show where time goes: agents working, slots, the
verify queue, usage pauses, and **human latency** (from `needs-decision`
to the answer) — the factory's main metric, since every other wait is
machine time.

## 7. What the manual stand-ins already do

Until epics 20 and 27 ship, the `epic-run` workflow
(`~/.claude/workflows/epic-run.js`) applies what needs no tool code: typed
holds in its report, the circuit breaker on repeated or environment
failures, critical path first, and a run journal in the AI memory vault
(`workflows/epic-run/`), read back as lessons at the start of each run.
Removal of the workflow, the skill and how their journal is kept: epic 27,
*Maintainer cleanup on delivery*.
