# Reliability benchmark (run once, 2026-10-17)

Coding Flow claims to make Claude Code **more reliable**: fewer forgotten files and
higher first-pass success, because the machine verifies instead of the agent
asserting. That claim is **unvalidated by data**. This document is the harness to
validate or refute it.

The results below are one run per cell: indicative, not proof. Cite them with that
caveat, and do not extrapolate them into a rate.

## Hypothesis

For real, non-trivial tasks, `Claude Code + Coding Flow` beats `Claude Code alone` on
first-pass success and forgotten-file rate, at comparable or lower token cost.

## Method

Each task runs twice from the same clean starting commit, in separate sessions:

- **A — vanilla:** Claude Code with a normal `CLAUDE.md`, free conversation.
- **B — coding-flow:** the same repo scaffolded with `init`, driven via `/flow-plan`
  then `/flow-run`.

Identical user-facing objective wording in both arms. Blind the grader to the arm
where feasible.

### Tasks (5, escalating)

1. **Fix** — a one-file bug or copy fix.
2. **CRUD** — add a resource with list/create/edit and its tests.
3. **Refactor** — extract a shared module used in 3+ places, no behavior change.
4. **Auth feature** — a permission-gated action with server-side enforcement.
5. **Cross-module bug** — a defect whose root cause spans 2+ modules.

Each task needs a fixture repo, a verbatim prompt, and a **machine-checkable
acceptance command** written *before* either arm runs. That acceptance command is the
grader; if it cannot be written, the task is not measurable and does not belong here.

### How the numbers are captured

Run each arm headless and read the metrics off the CLI rather than estimating them.
Verified 2026-08-19: `claude -p --output-format json` returns `usage`
(input/output/cache tokens), `total_cost_usd`, `num_turns`, `duration_ms` and
`permission_denials`.

```bash
claude -p "<the task prompt>" --output-format json > run.json
python3 -c "
import json; d=json.load(open('run.json')); u=d['usage']
print('in', u['input_tokens'], 'out', u['output_tokens'],
      'cache_r', u['cache_read_input_tokens'], 'cache_w', u['cache_creation_input_tokens'],
      'usd', round(d['total_cost_usd'],4), 'ms', d['duration_ms'], 'turns', d['num_turns'])"
<the task's acceptance command>; echo "acceptance exit=$?"
```

Pin `--model` explicitly in both arms, and record it. A model difference between arms
invalidates the comparison more thoroughly than any other error here.

**Round-trips need a protocol, not a count.** Headless runs have no user, so
`num_turns` is not the same quantity the interactive metric meant. Fixed protocol,
applied identically to both arms: if the acceptance command fails, re-prompt once
with the failure output verbatim, up to **3 re-prompts**, then record it as not
reaching green. Round-trips = the number of re-prompts used. This is mechanical and
comparable; an interactive run is not.

**Cache tokens are reported separately, never folded into a total.** Arm B loads
`RULES.md` and story files, so it reads more cache. Summing cache reads with fresh
input tokens flatters or penalises an arm depending on session order, which is not a
property of the tool.

### Metrics (per task, per arm)

| Metric | Source |
| --- | --- |
| First-pass success | Acceptance command exits 0 with zero re-prompts |
| Round-trips | Re-prompts used under the protocol above (0–3) |
| Tokens | `usage`, with cache reported separately |
| Cost | `total_cost_usd` |
| Files correct / missed | Diff vs. the reference solution, graded by hand |
| Time to green | `duration_ms`, summed across re-prompts |

## Results

Run 2026-10-17. Model `claude-sonnet-5-5` in both arms, coding-flow 0.12.1 (plugin)
with `ai-flow init` from this checkout, `claude` 2.1.302, headless
(`-p --output-format json --permission-mode acceptEdits`). **N = 1 per cell.**
The raw per-run JSON and acceptance output are committed in
[`evals/benchmark/runs/2026-10-17/`](../../evals/benchmark/runs/2026-10-17/README.md)
and every figure below is re-derivable from them. Totals are summed from unrounded
values, so they can differ by a cent from the rows. Arm B = `/flow-plan` then
`/flow-run` (two sessions, summed).

**Deviations first** (detail under *Deviations from the protocol and limits*): N = 1
per cell; the grader was not blind; ten sessions ran in parallel, so timings are
indicative; arm B was driven by the harness, not a person; "files forgotten" and
"escaped defects" were graded by hand after the fact, from the committed diffs.

| Task | Arm | First-pass | Round-trips | Tokens (in/out) | Cache read | Cost | Time |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 Fix | vanilla | yes | 0 | 8/1036 | 109,514 | $0.14 | 22s |
| 1 Fix | coding-flow | yes | 0 | 24/5606 | 503,036 | $0.46 | 75s |
| 2 CRUD | vanilla | no | 1 | 16/4687 | 215,940 | $0.31 | 58s |
| 2 CRUD | coding-flow | no | 1 | 34/12066 | 704,599 | $0.76 | 139s |
| 3 Refactor | vanilla | yes | 0 | 10/2646 | 141,031 | $0.17 | 36s |
| 3 Refactor | coding-flow | yes | 0 | 26/9543 | 578,240 | $0.56 | 103s |
| 4 Auth | vanilla | yes | 0 | 10/1987 | 142,921 | $0.17 | 60s |
| 4 Auth | coding-flow | yes | 0 | 20/9594 | 440,134 | $0.81 | 96s |
| 5 Cross-module | vanilla | yes | 0 | 12/1630 | 183,478 | $0.17 | 41s |
| 5 Cross-module | coding-flow | no | 1 | 46/10645 | 1,032,980 | $0.78 | 134s |
| **Total** | vanilla | 4/5 | 1 | 56/11,986 | 792,884 | $0.97 | 217s |
| **Total** | coding-flow | 3/5 | 2 | 150/47,454 | 3,258,989 | $3.36 | 547s |

All ten runs ended green on acceptance and regression after at most one re-prompt.

### What the numbers say

**The hypothesis is not supported by this run.** Coding Flow did not beat the agent
alone on first-pass success (3/5 against 4/5) and cost about 3.5× as much and 2.5×
the time. The arm that lost is coding-flow, on tasks 2 and 5.

- **Task 5 (cross-module) is the clearest loss.** Vanilla made a 3-line change in
  `report.js` and passed first time. Coding Flow added a `countsTowardTotals` helper
  to `approvals.js` (a file the fix did not need) and failed all 5 acceptance tests
  on its first attempt, passing after one re-prompt.
- **Task 2:** both arms failed the same 3 of 6 acceptance tests first time and
  passed after one re-prompt. No difference.
- **Where coding-flow did differ is the tests it left behind.** Hand-graded against
  each `REFERENCE.md`: vanilla added no test of its own on task 3 (the refactor);
  coding-flow added 5 tests (`spec/{approvals,expenses,routes,users}.spec.js`, 124
  lines). On tasks 1 and 5 coding-flow added 15 and 39 net lines of specs against
  vanilla's 2 and 10; on task 4, 76 against 28; on task 2, 158 against 84. That is the only
  measured advantage, and acceptance does not score it.
- **Scope (tasks 3 and 4).** Vanilla left `rejectExpense` alone in both. On task 3
  coding-flow routed `rejectExpense` through a new shared `requireActor` helper (the
  role check is not added, so behaviour is unchanged) and removed the router's copy;
  it ended at 1 duplicated occurrence against a target of 2. Neither arm asked about
  the `rejectExpense` inconsistency.
- **Files forgotten: none, in either arm.** Graded by hand from `final.patch` against
  each `REFERENCE.md`: every file the reference says should change changed, every
  required test was written (tasks 2 and 4), and `store.js`, `expenses.js` and
  `report.js` were left alone where the reference says so. The only out-of-scope
  edit is coding-flow's `approvals.js` on task 5.
- **Escaped defects: none found, in either arm.** Hand-graded from the same diffs:
  neither arm changed `rejectExpense`'s behaviour, moved the comparison in task 4, or
  leaked vendors into the report, and the regression suite is green in all ten final
  trees. This is a read of ten small diffs by the person who ran them, not a hunt, and
  "none found" is not "none". Nothing here shows coding-flow catching a defect
  vanilla shipped.

### Deviations from the protocol and limits

- **Files forgotten and escaped defects were graded after the runs**, by hand, from
  the diffs. The final `src/`+`spec/` diffs were exported from the surviving
  workspaces after the fact (`final.patch`); everything else in `runs/` is as the
  runs wrote it.
- **N = 1 per cell, non-deterministic model.** A single re-prompt on one task is the
  whole difference in first-pass counts; do not read 3/5 against 4/5 as a rate.
- **The grader was not blind.** The same person set up, ran and graded both arms.
  The hand grading of files and defects above has the same limit.
- **Time** is `duration_ms` summed over the planning session, the run and any
  re-prompt, so arm B pays for `/flow-plan` in every task.
- **Arm B's operator was the harness**: the task prompt was passed to `/flow-plan`
  verbatim, then `/flow-run the story you just planned`. A hand-guided session may
  do better or worse.
- Tasks ran in parallel, ten sessions at once; timings are indicative only.
- The model was `claude-sonnet-5-5`; a stronger model may erase the gap the other way.

## The fixture and the prompts

Both exist: [`evals/benchmark/`](../../evals/benchmark/README.md).

`fixture/` is **Ledger**, a zero-dependency expense-reporting app whose own 17-test
suite is **green and wrong** — two defects ship in the baseline that no existing
test can reach. A fixture whose suite already catches its bugs measures typing
speed, not reliability.

Each of the five tasks carries a verbatim `PROMPT.md`, an `accept.spec.js` grader
copied in only *after* the run, a `REFERENCE.md` naming the traps and what is
hand-graded, and a `reference.patch` verified to pass.

```bash
WORKSPACE=$(node evals/benchmark/run.js setup 05-cross-module)
cat evals/benchmark/tasks/05-cross-module/PROMPT.md
# ... the arm works in $WORKSPACE ...
node evals/benchmark/run.js accept "$WORKSPACE" 05-cross-module
```

The harness is itself validated against two arms: a run that does nothing fails all
five tasks, and `reference.patch` passes all five with the regression suite green.

The ten sessions have been run once (see Results); more runs per cell are what would
make them a rate.

## Honesty rules

- LLM runs are non-deterministic and N is small: results are **indicative**, not
  proof. Report the raw runs, not a cherry-picked best.
- If coding-flow ties or loses on a task, **say so here**. A negative result is the
  point of running the experiment, and publishing one is worth more to this tool's
  argument than a win it cannot show.
- Publish the fixture repo and the verbatim prompts so the numbers are reproducible.
