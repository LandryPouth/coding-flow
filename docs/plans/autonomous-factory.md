# Autonomous factory: a tool that measures itself and proposes its own fixes

> Asked on 2026-11-12, after two epics (37, 38) and the start of 39 ran on bethl
> with one orchestrating session. The ask: Coding Flow runs whole epics alone —
> including minor non-dev decisions, architecture choices that have a precedent,
> and the house coding style — is ready for a team, and learns from its own runs
> to propose improvements to itself. Memory in Obsidian; a watcher agent studies
> the runs.
>
> Short answer: yes, but the watcher **proposes and measures**; it never edits the
> tool or relaxes a gate on its own. And the first deliverable is not the agent,
> it is the data — most of what the watcher would need is either not recorded or
> recorded wrong today (numbers below).

**Status: planned** as epics 18–24 (2026-11-12). Nothing implemented. Complements the bethl
`docs/DOGFOODING.md` section "Bilan : ce qu'il faut pour qu'une epic tourne seule
(2026-11-12)" (epic orchestrator, detached verify, autonomy policy), which this
plan assumes.

## Baseline: what the runs already say

Computed from `.coding-flow/runs/*.json` on 2026-11-12 (script: one pass over
verify and review records, no sampling).

| | bethl | ai-learn | coding-flow |
|---|---|---|---|
| verify runs | 614 | 265 | 184 |
| stories | 173 | 45 | 56 |
| red runs | 130 (21 %) | 62 (23 %) | 5 (3 %) |
| machine time in verify | 44.3 h | 13.4 h | 0.6 h |
| verify p50 / p90 | 3.2 / 9.0 min | 1.9 / 7.2 min | 10 / 22 s |
| green on first verify | 129 / 173 (75 %) | 35 / 45 | 56 / 56 |
| **red trees that went green with no change** | **27 / 115 (23 %)** | **17 / 52 (33 %)** | 0 / 4 |

bethl, red runs by failing command: tests 91, lint 49, typecheck 21. Five reds
only were gates (coverage, criteria) with commands green.

What this says:

1. **A quarter to a third of the reds are noise.** Same tree, same untracked
   files, red then green: flaky tests, memory kills, timeouts. Each costs a
   full rerun (3–9 min) and an agent turn spent "investigating" nothing. Today
   happened again: 39-02 red on a `@workspace/clips` timing test the epic never
   touched, green alone.
2. **Lint is 38 % of bethl's command failures** and is almost entirely
   mechanical (format, import order). A `lint --fix` before verify removes a
   class of reds instead of reporting it.
3. **Review records measure the residue, not the review.** `findingCounts` is
   captured after the fixes, so a review that found 2 majors and got them fixed
   records `p1: 0`. That is why the data shows self-review "finding" more
   (0.28 p0+p1 per review, 155 reviews) than the independent subagent (0.17,
   29 reviews) — the opposite of what happened in practice (39-01: subagent found
   2 majors the worker missed). The single most useful comparison the watcher
   could make is impossible with the current record.
4. **Human interventions are not recorded at all.** bethl transcripts hold 1 064
   user messages over 117 sessions (~6 per story), but nothing says which were
   product decisions (wanted) and which were corrections or restarts (the cost
   of non-autonomy). A regex for corrections finds 6 — it has to be classified,
   not grepped.
5. **Session memory is not a store.** The DOGFOODING bilan of 2026-11-12 was
   written from what the session remembered; that session was compacted hours
   later and the exact timings, errors and restarts are gone.

## What autonomy actually gains (targets)

| Lever | Today (bethl) | Target | What it buys |
|---|---|---|---|
| Noise reds | 23 % of reds | < 5 %, and never blocking unrelated code | ~1 rerun saved every 5 stories, no false "blocked" |
| Mechanical lint reds | 49 runs | ~0 | the commonest red disappears |
| Human turns per story | ~6 | ≤ 1 per epic outside product decisions | epics run overnight |
| Verify blocked by RAM | ad hoc kills | queued, never killed | no lost runs |
| Defects escaping to after land | unknown | measured, then trending down | the only metric that proves the rest |

## The loop, in five layers

Each layer is useful on its own and is the input of the next. Build in order.

### 0. Event journal (the prerequisite)

`ai-flow` appends one line per event to `.coding-flow/events.jsonl`, the same
way it already writes `denials.jsonl`. Every record carries `at`, `project`,
`epic`, `story`, `actor` (agent session id or human), `tree` (treeToken).

| Event | Fields that matter |
|---|---|
| `verify.start` / `verify.end` | per command: duration, exit, timedOut, killed-by (oom/timeout/signal), failing test names (parsed from the runner output, not the tail) |
| `gate.fired` | gate, outcome: `test-added` / `exempted` / `overridden` / `abandoned` |
| `review.found` | at capture time **before fixes**: each finding with severity, category, file, reviewer kind |
| `review.resolved` | per finding: `fixed` / `documented` / `rejected` + reason |
| `story.status` | from → to, with the proof it rests on |
| `worktree.*` | place / lock / unlock / land / conflict (files) |
| `decision.made` | level (`decide` / `decide-and-note` / `ask`), topic, precedent cited, answer |
| `human.turn` | classified: `product-decision` / `correction` / `restart` / `approval` / `info` |
| `release` / `incident` | from deploy hooks and Sentry: which commits, which stories |

`human.turn` is produced by a classifier pass over transcripts at the end of a
run (cheap model), since the CLI does not see the chat. `review.found` fixes
point 3 above by splitting capture into find-then-resolve.

### 1. Insights (deterministic, no model)

`ai-flow insights [--since] [--project all]` computes the catalogue below from
the journal. Pure arithmetic, reproducible, testable — the watcher reads this,
it does not recompute it.

| Metric | Definition | Signals |
|---|---|---|
| Autonomy | human turns that are not `product-decision`, per story / epic | is the factory running alone |
| First-pass yield | stories green on first verify | quality of the worker's own checks |
| Noise rate | red trees later green unchanged / red trees | flaky tests, resource kills |
| Flake ledger | test names red-then-green on the same tree, with counts | quarantine candidates |
| Gate precision | `gate.fired` → `test-added` vs `exempted`/`overridden` | a gate mostly exempted is miscalibrated |
| Review catch | findings by reviewer kind, by severity, by category; how many the worker's notes did not mention | value of independent review |
| Escape rate | incidents or `fix:` commits after land touching a story's files within N days | what every gate missed |
| Rework | commits on a story after `done` | premature done |
| Cost | tokens and wall time per story by mode (QUICK..STRICT) | mode selection accuracy |
| Decision drift | `ask` decisions answered the same way ≥ 3 times | candidates to move to `decide` |
| Rule leakage | skill rules broken (done before verify, criteria ticked before proof) | prose to turn into a CLI check |

### 2. Watcher agent (proposes, never applies)

Runs at the end of each epic and weekly across projects, in a **fresh context**
fed only `insights` output plus sampled raw events — never the transcripts of the
sessions it judges in full, never their reasoning (same independence argument as
STRICT review).

It writes at most **three** proposals per pass, ranked by measured gain. Each one:

```md
## <title>
- Evidence: metric, value, window, run ids, projects
- Change: the concrete diff (skill text, config default, CLI check, test)
- Success measure: which metric moves, by how much, over how many runs
- Risk: what it could hide or break
- Status: proposed → accepted → measuring → confirmed | reverted
```

It never proposes on its own authority: relaxing or disabling a gate, touching
anything that guards production, deleting a test, raising its own budget. Those
are filed as questions for the maintainer.

### 3. Experiments (proposals are tested, not believed)

`evals/benchmark` and `docs/experiments` already define a protocol for "Coding
Flow vs agent alone". Reuse it: an accepted proposal ships behind a config flag,
the benchmark runs with and without it, and production runs report the metric
for a fixed window. A proposal whose metric does not move is reverted, and the
revert is recorded — the watcher must see its own misses or it will repeat them.

Gates get a **shadow mode** first: a new or changed gate logs `gate.fired`
without blocking for N runs, so its precision is known before it can stop work.

### 4. Knowledge (what the factory knows about each project)

Two stores, deliberately separate:

- **In the repo, for agents and teammates** — the source of truth.
  - `docs/decisions/` — a registry harvested from every story's `## Decisions`,
    indexed by topic (locks, money, time zones, i18n, error shapes…). A worker
    facing a choice searches precedent first; a cited precedent is what turns an
    architecture question into a `decide-and-note` instead of an `ask`.
  - `docs/conventions.md` — the house style, grown by a **promotion ladder**:
    a review finding category seen 3 times → convention entry → lint rule or
    test → gate. Every rung records the findings that justified it. This is how
    "the way we code" becomes enforceable instead of remembered.
  - `.coding-flow/autonomy.md` — the decision policy (Décide / Décide et note /
    Demande) per topic; the watcher proposes moves between levels from
    `decision drift`, the maintainer accepts.
- **In Obsidian, for the human** — a view, not a source: one note per proposal,
  per recurring problem, per experiment, linked across projects; dashboards over
  `insights`. A problem seen in bethl, ai-learn and coding-flow is a tool problem;
  seen in one, a project problem. Export is one-way (journal → vault), sanitized:
  paths, metrics, categories — no code, no customer content, no secrets.

Personal agent memory (Claude's `MEMORY.md`) stops being where project
preferences live. Today bethl has ~30 memories, most of them design and
convention rules ("UI sobre", "shadcn first", "visible separators") that a
teammate's agent never sees. They belong in `docs/conventions.md` and
`autonomy.md`; the watcher can propose the migration item by item.

## Team readiness

What breaks the day a second person (or a second machine) runs the factory:

| Today | Team version |
|---|---|
| Verify on the laptop, killed when RAM is short | verify as a job: local queue gated on memory, or a runner (CI) that `ai-flow verify --remote` dispatches to and records the same evidence |
| Locks are local files | locks as git refs (`refs/coding-flow/locks/<story>`) pushed to the remote, so two machines see each other |
| Land = local merge | per-project setting: `land: local` (solo) or `land: pr` (team, through `/flow-ship` and branch protection) |
| Decisions answered by one user | `autonomy.md` names who answers which topic; an `ask` is routed (issue comment, Slack) and the epic continues on other branches while waiting |
| Preferences in one person's agent memory | in the repo (above) |
| Evidence trusted because it is local | evidence signed by provenance (already: commit, treeToken, host) and re-checked by CI, so a teammate does not have to trust a laptop |
| Intake by chat | intake from issues/boards → `/flow-plan` draft → human validates the plan, the only mandatory gate before code |

## The factory, end to end

```text
intake (issue, board, chat)
  → plan (human validates)                          ← the one upfront gate
  → scheduler: dependency tree, ≤ N parallel, RAM/CI budget
  → workers (fork per story, worktree each)
  → verify farm (tiers: fast → unit → integration → browser; flake quarantine)
  → independent review (fresh context) → fix loop
  → epic review → land (local or PR)
  → release (human green light for prod)            ← the one downstream gate
  → production signals (Sentry, uptime) → incident linked to stories
  → events.jsonl → insights → watcher → proposals → experiments → tool
```

The two human gates stay: validating what to build, and green-lighting prod.
Everything between them is the tool's job, and every "Demande" in between is a
cost the watcher tries to remove with a precedent or a policy.

## Risks

- **Goodhart.** Optimising first-pass yield invites weaker tests; optimising
  autonomy invites not asking when it should. Escape rate is the counterweight
  and must be measured before any other metric is optimised.
- **Small samples.** 173 stories on one project. Early proposals must say
  "seen 3 times in 2 weeks", not "improves yield by 12 %".
- **One user's taste becomes the tool's.** Conventions are per project; only
  cross-project patterns become tool defaults.
- **Cost.** The watcher and the classifier spend tokens; budget them per pass and
  record their own cost as a metric.
- **Privacy.** The cross-project vault receives sanitized events only.

## Roadmap — planned as epics 18 to 24 (2026-11-12)

Planned with `/flow-plan` after the research
([`docs/research/reports/Usines à code IA.md`](../research/reports/Usines%20à%20code%20IA.md)),
which confirmed this plan and added four things now in the epics: tests
read-only during driven runs and a bounded number of attempts (the only
measured mitigations of reward hacking), playbooks extracted from runs that
worked, and a merge queue that re-verifies the merged tree once chains run in
parallel. The freeze exception is design-decisions entry 15.

Order: judge and memory first, engine second, learning last. An unattended
loop on a signal that is noise one time in four learns to work around the
noise.

| Epic | What it delivers | Layer |
|---|---|---|
| [18 — The run remembers](../../epics/epic-18-the-run-remembers/index.md) | event journal, proof survives the land, notes-only edits keep the proof, reviews captured as found, ticks name their proof | 0 |
| [19 — The judge holds](../../epics/epic-19-the-judge-holds/index.md) | failing test names, noise told apart, machine queue, detached verify, fixers, tiers, tests read-only when nobody watches | 0 |
| [20 — The epic runs itself](../../epics/epic-20-the-epic-runs-itself/index.md) | `ai-flow run --driver claude`: headless story, owned worktree, bounded retries, second reviewer, ready agent stories, resume, epic review and report | engine |
| [21 — The factory sees itself](../../epics/epic-21-the-factory-sees-itself/index.md) | `insights`, the Markdown vault, cross-project numbers, review and gate value, human turns, escapes | 1 + vault |
| [22 — Decisions without asking](../../epics/epic-22-decisions-without-asking/index.md) | `autonomy.md`, searchable precedents with provenance, the promotion ladder, memory into the repo, playbooks, a personal taste profile, design-system checks | 4 |
| [23 — The factory proposes its own improvements](../../epics/epic-23-the-factory-proposes-its-improvements/index.md) | watcher, maintainer-only proposals, shadow gates, experiments, after every epic | 2 + 3 |
| [24 — Many hands](../../epics/epic-24-many-hands/index.md) | clean worktrees, parallel chains with a merge queue, shared locks, PR land, trusted runner, routed questions | team |

Before them: finish epic 15, then 16 (story 16-01's `Assumption
(unconfirmed)` marker is what epic 20 s5 reads) and 17 (archiving).

### Maintainer to-do

- ~~Give the path of a new Markdown vault~~ — **done 2026-11-12**:
  `~/dev/.ai-memory-vault` (fixed path, private git repository, scaffolded,
  `AGENTS.md` contract, `preferences/` seeded with proposed rules for 22-06).
  It is the cross-project store of what Coding Flow learns for as long as the
  tool needs to mature; 21-02 adopts it with `vault init --adopt`.
- Confirm or veto the labeled defaults: 2 attempts per story, 45-minute limit
  per agent process, budget caps required in config (no default spend),
  parallelism 1 (cap 2), 1 retry of a failed command in driven runs.
