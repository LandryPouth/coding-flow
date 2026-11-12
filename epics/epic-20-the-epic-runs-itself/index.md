# Epic 20 — The epic runs itself

## Goal

`ai-flow run --driver claude --epic <epic>` takes a plan the maintainer
validated and runs it to a final report without anyone saying "continue":
each story in a fresh agent process, in a worktree the run owns, verified by
the CLI, retried a bounded number of times, reviewed by a second independent
process when STRICT, marked `done` by the tool and never by the agent, landed
locally when its chain finishes; questions park only the stories that need an
answer; the run survives a crash and resumes; the epic ends with an
epic-wide review and one report the maintainer reads instead of every story.

## Why

- **The maintainer is the orchestrator today.** bethl epics 37–38: about 20
  process interventions against 6 product decisions. The 39-01 worker stalled
  600 s waiting for a verify notification; a worker cannot spawn the
  independent review STRICT requires; criteria were ticked before verify and
  `done` written before review (bethl DOGFOODING 2026-11-12, P0).
- **The engine was designed and set aside** on 2026-11-10
  (`docs/research/research_notes/Usines à code IA/session_abandonnee_autonomie.md`):
  a driver behind the existing `run` seam, `claude -p` per story, verify by the
  CLI, review in a second process. The research confirms it point by point
  (fresh process per unit: Ralph, Anthropic's C compiler at 2 000 `claude -p`
  sessions; verifier out of the agent's reach; bounded attempts; stop at a
  branch, human merge to main) and adds four things: bounded retries with
  forced reflection, protected tests (epic 19 s7), an escape hatch, and a
  headless guard self-test before the batch.
- **Premise change:** design-decisions entry 15.

## Scope

**In scope**

- Driver `claude` in `RUN_DRIVERS`, `--story` then `--epic`, sequential.
- Preflight that refuses the batch rather than start unsafe.
- The run owns its worktree: placement never takes a checkout another
  session is working in; dependencies installed, declared env files copied;
  autoland decided from the placement registry, not the caller's directory.
- Bounded attempts with a reflection prompt; a wall-clock limit per process;
  a stalled process killed and counted.
- STRICT review in a second, read-only process; findings captured found-then-
  resolved (epic 18 s4); one bounded fix pass; the tool writes `done`.
- Story ownership (`agent` | `human`) and readiness; `## Needs you` instead of
  questions; dependents skipped, independent chains continue.
- Durable run state, `--resume`, budget and turn caps per story and per run.
- Epic-wide review over the whole diff, and `REPORT.md`.

**Out of scope**

- Parallel chains and merge re-verification (epic 24 s2); default parallelism
  is 1.
- Drivers for other hosts (`codex exec`, `opencode run`): the seam is kept
  host-neutral; a second driver is its own story once this one is measured.
- Merging to `main`, pushing, production. The run stops at local land (or the
  epic branch, per `branchPerEpic`).
- Browser checks beyond the declared `browser` tier checklist.

## Backbone

`Backbone: one story runs headless → in a worktree it owns → retried within bounds → reviewed by another process and marked done by the tool → only ready agent stories run, questions park → the whole epic runs and resumes → it ends with an epic review and a report`

The stories form a plain chain (all extend `bin/lib/run.js` and the driver
module), so there is no tree.

## Stories

1. **story-20-01-one-story-runs-headless** *(STRICT — walking skeleton: preflight → place/lock → `claude -p` → CLI verify → cost recorded → run report)*
2. **story-20-02-the-run-owns-its-worktree** *(STRICT — placement, locks, autoland)*
3. **story-20-03-a-red-story-gets-bounded-retries** *(STANDARD)*
4. **story-20-04-strict-stories-get-a-second-reviewer** *(STRICT — the tool writes `done`)*
5. **story-20-05-only-ready-agent-stories-run** *(STANDARD)*
6. **story-20-06-the-whole-epic-runs-and-resumes** *(STRICT — budget caps, unattended batch)*
7. **story-20-07-the-epic-ends-with-a-review-and-a-report** *(STANDARD)*

## Decisions

- **The CLI is the orchestrator; agents are processes.** Not an orchestrator
  skill in the main session: a process per story gives a genuinely fresh
  context, survives the session's compaction, and lets the CLI spawn the
  reviewer the worker could not. Agent teams cannot run under `-p`.
- **Invocation (verified against the installed `claude` before 20-01 codes it):**
  `claude -p "/coding-flow:flow-run <story>" --permission-mode dontAsk
  --allowedTools <list> --max-turns N --max-budget-usd X --output-format json`;
  never `--bare` (it skips hooks, i.e. the guard). Questions are disabled; the
  agent writes `## Needs you` and stops.
- **Driven mode is a contract the tool enforces.** An env marker
  (`AI_FLOW_DRIVEN=<run id>`) tells the skill and the guard: the agent
  implements, runs narrow tests, writes `## Result`; it does not run `verify`,
  does not write `## Status`, does not review itself. The guard refuses a
  `## Status: done` written by a driven agent. This turns the four prose rules
  broken on bethl into checks.
- **Preflight refuses the whole batch** unless: the guard denies a write to a
  probe `.env` in a headless self-test on this machine, harness `mode: strict`
  (or the documented equivalent), validation commands come from `config.json`,
  the story is `ready` and owned by `agent`, and the budget caps are set.
- **Attempts:** default 2 implementation attempts per story, each a fresh
  process whose prompt carries the failing test names (epic 19 s1) and a
  required "why did it fail, what changes" paragraph; then `blocked`. One fix
  pass after review. A process over its wall-clock limit is killed and counts
  as an attempt.
- **Ownership:** `Owner: agent | human` line in the story, default `human`;
  `/flow-plan` writes it; `/flow-next` shows `human` stories to the maintainer.
  A story carrying `Assumption (unconfirmed)` (story 16-01) is not ready.
- **Budget:** the run records `total_cost_usd` per process; caps per story and
  per run come from `config.json` (`run.budgetUsd.story`, `run.budgetUsd.run`)
  and must be set for preflight to pass — no silent default spend.
- **Report:** `epics/<epic>/REPORT.md`, rewritten at the end of the run (and
  mirrored to the vault once epic 21 s2 exists): delivered stories with proof
  rung and review origin and found/resolved counts, decisions taken alone
  (`decide-and-note`, epic 22), `Needs you` questions, maintainer to-do, cost,
  wall time, attempts.

## Dependencies outside this epic

- Epic 18 s1 (journal), s2 (proof survives the land), s4 (find/resolve).
- Epic 19 s1 (failing test names), s7 (tests read-only), and ideally s2–s4.
- Story 16-01 (`Assumption (unconfirmed)` marker).

## Readiness

`ready`, with labeled defaults open to veto: 2 attempts; per-process
wall-clock limit 45 minutes; caps required in config (no default spend);
parallelism 1. The exact `claude` flag set is verified on the installed version
inside 20-01 (a stop condition if `dontAsk` + guard denial cannot be proven
headless).
