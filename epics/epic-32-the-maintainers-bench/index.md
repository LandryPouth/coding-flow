# Epic 32 — The maintainer's bench

## Goal

The maintainer can measure every run of Coding Flow, in every project on this
machine: tokens, time, rounds, waits and the tool's own weight. Each change to
the tool or to the way runs are driven is compared with a recorded baseline,
and the bench proposes what to improve, with its evidence.

**This is the maintainer's instrument, not part of the tool.** The maintainer
decided this on 2026-11-25: "le bench reste pour moi et pas pour l'outil, on
ne va pas le charger". It lives in `evals/bench/`, outside the npm package
(`package.json` `files`). It adds no `ai-flow` command or flag, and no skill. It
is never loaded by a user's install.

## Why

- **The maintainer asked for it on 2026-11-25:** a real tool that studies and
  measures runs, records what it finds in the vault, and proposes how to gain
  time, efficiency and weight.
- **The data exists, and nothing reads it.** Claude Code transcripts (`usage`
  per turn), the OpenCode database (tokens per session), `.coding-flow/runs/`
  evidence and git history. The baseline taken on 2026-11-25 (vault
  `workflows/epic-run/bench/2026-11-25-baseline.md`), read from every project
  on the machine:

  | Project | Main session | Implementers | Reviewers | Verify |
  |---|---|---|---|---|
  | bethl | 5,826 M tokens | 1,038 M (~214 k/turn) | 525 M (~141 k/turn) | 690 runs, 57.6 h |
  | coding-flow | 1,187 M | 1,314 M (~221 k/turn) | 419 M (~87 k/turn) | 341 runs, 24.6 h |
  | tse-binam | 2,502 M | 195 M | — | — |

  **The orchestrating session costs more than all its agents together.** On
  bethl, the main session read 5.8 B tokens against 1.9 B for its agents. One
  verify in five was red on bethl and coding-flow, and each red cost a full
  rerun.
- **The transcripts expire.** Claude Code deletes them after 30 days by default,
  so only snapshots keep the history.
- **What already exists is reused, not redone:**
  - `evals/benchmark/` (the Ledger fixture, 5 tasks with hidden graders, a
    protocol in `docs/experiments/reliability-benchmark.md`) is the replay
    bench;
  - epic 23's proposal format (vault notes with evidence, change, success
    metric, risk) is the format the bench writes;
  - `evals/bench/seed-extract.js` is the one-off script that took the
    baseline.
- **Epic 31 is measured by it.** Its stories change how runs spend tokens; this
  epic proves or refutes the gain against the baseline.

## Scope

**In scope**

- A ledger: snapshots of every source, as aggregates, kept in the vault and
  compared run over run.
- The tool's weight, with budgets in this repository's CI.
- Detectors that turn ledger patterns into proposals in the vault.
- Two-arm experiments on `evals/benchmark`.

**Out of scope**

- Anything in the npm package or the `ai-flow` CLI.
- Story 31-04's in-tool cost report and `status` budget warning. The
  maintainer moved them here on 2026-11-25, as 32-01.
- Message content, at any step. Only numbers, agent descriptions, model ids
  and project aliases are kept.
- Applying a proposal. The maintainer decides, as in epic 23.

Backbone: snapshot every run → weigh the tool → detect what wastes → test a change in two arms

```text
s1
├── s2
├── s3
└── s4
```

s2 (weight) reads only this repository and CI, so it is independent of s1's
data. s3 reads s1's snapshots. s4 reads s1's per-arm numbers. Their files are
disjoint: `evals/bench/weight*`, `evals/bench/detect*`, `evals/benchmark/`.

## Stories

1. [story-32-01-a-ledger-of-every-run](story-32-01-a-ledger-of-every-run/spec.md) *(STANDARD — walking skeleton: every source → aggregate snapshot in the vault → comparison with the previous one)*
2. [story-32-02-the-tool-has-a-weight](story-32-02-the-tool-has-a-weight/spec.md) *(STANDARD)*
3. [story-32-03-a-waste-becomes-a-proposal](story-32-03-a-waste-becomes-a-proposal/spec.md) *(STANDARD)*
4. [story-32-04-a-change-is-tried-in-two-arms](story-32-04-a-change-is-tried-in-two-arms/spec.md) *(STANDARD — spends tokens on purpose; budgeted)*

## Human to-do

- [ ] (before: later) Decide whether to keep Claude Code transcripts longer:
      `cleanupPeriodDays` in `~/.claude/settings.json`, default 30. They take
      about 1.7 GB today. The bench keeps aggregates either way, so this only
      matters to re-read a past run in detail.

## Readiness

ready. The baseline exists. Sources and their formats were read on disk on
2026-11-25.
