# Epic 27 — The run knows why it stopped

## Goal

A driven run always knows, and says, why each story is not moving, who must
act and how: holds are typed (`waiting`, `paused`, `failed`,
`needs-decision`, `parked`, `skipped`, `error`, `stopped`), failures are
classified before anything is retried, a broken environment stops the run
instead of burning stories, work is checkpointed in git, the critical path
goes first and the base stays in sync, a run is previewed and stopped
cleanly, questions arrive as decision packets, and notifications have
levels. Design: [`docs/plans/orchestration.md`](../../docs/plans/orchestration.md).

## Why

- "Blocked" covered four situations with four owners (red tests, a
  question, a failed merge, a budget stop); status, todo, watch, report and
  notifications could not be right without the reason (orchestration.md).
- `run.stopAfterBlocked` cannot tell three bad stories from one broken
  machine; on bethl, environment failures (missing built packages, a
  corrupted dev index, a port held by Windows) looked like story failures.
- Resume trusted a state file only; the commits already in git were not
  read.
- The maintainer asked for "the most perfect orchestration" on 2026-11-13:
  waits, blocked, failed, success, notifications.

Freeze: within the factory exception (design-decisions entry 15).

## Scope

**In scope**: the hold model and its `Hold:` line; failure taxonomy and
circuit breaker; commit trailers and git-aware resume; critical path and
base sync; `run --plan`, `--stop`, `--abort`; decision packets, `ai-flow
answer`, timed decisions; notification levels, quiet hours, reminders,
digest; time per state and human latency.

**Out of scope**: routing questions to owners (24-06), the notify command
itself (26-02), cross-machine locks (24-03).

## Backbone

`Backbone: a hold says why → failures are classified and a broken machine stops the run → commits are checkpoints → the critical path goes first and the base stays in sync → a run is previewed and stopped cleanly → questions arrive as decision packets → notifications have levels and waits are measured`

```text
s1
├── s2
├── s3
├── s4
├── s5
├── s6
└── s7
```

Every story reads or writes the hold model of s1; beyond it they touch
disjoint modules (classifier, git trailers, scheduler, CLI verbs, packets,
notify policy).

## Stories

1. **story-27-01-a-hold-says-why** *(STANDARD — walking skeleton: one hold reason end to end, state → story line → status → report)*
2. **story-27-02-failures-are-classified-and-a-broken-machine-stops-the-run** *(STANDARD)*
3. **story-27-03-commits-are-checkpoints** *(STANDARD)*
4. **story-27-04-the-critical-path-goes-first-and-the-base-stays-in-sync** *(STRICT — unattended merges of the base)*
5. **story-27-05-a-run-is-previewed-and-stopped-cleanly** *(STANDARD)*
6. **story-27-06-questions-arrive-as-decision-packets** *(STANDARD — timed decisions gated by autonomy.md)*
7. **story-27-07-notifications-have-levels-and-waits-are-measured** *(STANDARD)*

## Decisions

- **`## Status` keeps its values**; the reason lives in a `Hold:` line the
  CLI writes. Old tools keep reading `blocked`; new ones read why.
- **Classify before retry**: an attempt is spent only on causes an attempt
  can fix.
- **Git is the checkpoint of record**; the state file is a cache of it.
- **Timed decisions are off by default** and never apply to irreversible
  topics.

## Dependencies outside this epic

Epic 20 (driver, state, retries, review), epic 18 (journal), 19-02 (noise),
22-01 (`autonomy.md`), 26-02 (notify command), 21-01 (estimates for
`--plan`, optional: without history the estimate is omitted).

## Delivery order

After epic 20, before 26-01/02/05 and epic 24 s1, s2, s7: parallel chains
need the hold model to say which chain waits on what.

## Readiness

`ready`.

## Maintainer cleanup on delivery

The manual stand-ins — the `epic-run` workflow
(`~/.claude/workflows/epic-run.js`), the `epic-run` skill
(`~/.claude/skills/epic-run/`) and their doc — are removed once **epic 20
and this epic are delivered** and a native `ai-flow run --epic` has run a
real bethl epic to its land. Then:

- [ ] Compare the workflow's loop with the native one (fresh reviewer that
      never sees the implementer's reasoning, skeptics, crossing review,
      completeness critic, findings carried to later stories, typed holds,
      circuit breaker, critical path, run journal and lessons). Anything the
      native run lacks becomes a story first — not a silent loss.
- [ ] Move each still-valid lesson from the vault's
      `workflows/epic-run/lessons.md` into `coding-flow/proposals/` (one
      proposal per lesson, template `_templates/proposal.md`).
- [ ] Keep `workflows/epic-run/runs/` as history: set the zone's
      `README.md` to `status: retired`, add the date; the runs stay
      readable in Obsidian.
- [ ] `trash ~/.claude/workflows/epic-run.js ~/.claude/skills/epic-run
      ~/.claude/docs/skills/epic-run.md`
- [ ] Remove the `epic-run` row from `~/.claude/README.md`, and the
      `workflows/epic-run/` line from the vault's `AGENTS.md` and `Home.md`.
