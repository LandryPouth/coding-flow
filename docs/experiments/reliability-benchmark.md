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
Arm B = `/flow-plan` then `/flow-run` (two sessions, summed).

**Deviations first** (detail under *Deviations from the protocol and limits*): N = 1
per cell; the grader was not blind; ten sessions ran in parallel, so timings are
indicative; arm B was driven by the harness, not a person; arm A ran with the
coding-flow plugin installed (not initialised, not invoked); the task 5 prompt
admits the reading arm B took; "files forgotten" and "escaped defects" were graded
by hand after the fact, from the committed diffs.

The table below is the output of
`node evals/benchmark/run.js summarize evals/benchmark/runs/2026-10-17`, computed
from the raw runs committed in
[`evals/benchmark/runs/2026-10-17/`](../../evals/benchmark/runs/2026-10-17/README.md).
Do not edit it by hand: `test/benchmark-results.test.js` fails when it stops
matching. Totals and ratios are computed from unrounded values.

<!-- summarize:begin -->
| Task | Arm | First-pass | Round-trips | Tokens (in/out) | Cache read | Cache write | Cost | Time | Spec lines added |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 fix | vanilla | yes | 0 | 8/1,036 | 109,514 | 30,490 | $0.14 | 22s | 2 |
| 1 fix | coding-flow | yes | 0 | 24/5,606 | 503,036 | 88,900 | $0.46 | 75s | 15 |
| 2 crud | vanilla | no | 1 | 16/4,687 | 215,940 | 61,509 | $0.31 | 58s | 84 |
| 2 crud | coding-flow | no | 1 | 34/12,066 | 704,599 | 141,605 | $0.76 | 139s | 158 |
| 3 refactor | vanilla | yes | 0 | 10/2,646 | 141,031 | 33,070 | $0.17 | 36s | 0 |
| 3 refactor | coding-flow | yes | 0 | 26/9,543 | 578,240 | 100,782 | $0.56 | 103s | 124 |
| 4 auth | vanilla | yes | 0 | 10/1,987 | 142,921 | 34,226 | $0.17 | 60s | 28 |
| 4 auth | coding-flow | yes | 0 | 20/9,594 | 440,134 | 53,187 | $0.81 | 96s | 76 |
| 5 cross-module | vanilla | yes | 0 | 12/1,630 | 183,478 | 33,033 | $0.17 | 41s | 10 |
| 5 cross-module | coding-flow | no | 1 | 46/10,645 | 1,032,980 | 142,194 | $0.78 | 134s | 44 |
| **Total** | vanilla | 4/5 | 1 | 56/11,986 | 792,884 | 192,328 | $0.97 | 217s | 124 |
| **Total** | coding-flow | 3/5 | 2 | 150/47,454 | 3,258,989 | 526,668 | $3.36 | 547s | 417 |

coding-flow against vanilla: cost 3.5×, time 2.5×, cache writes 2.7×, spec lines added 3.4×.
<!-- summarize:end -->

All ten runs ended green on acceptance and regression after at most one re-prompt
(`*/accept-*.txt`).

### What the numbers say

**The hypothesis is not supported by this run.** Coding Flow did not beat the agent
alone on first-pass success (3/5 against 4/5) and cost more on every task. It tied
on tasks 1–4 and lost on task 5; no task shows it ahead on the scored metrics.

- **Task 5 (cross-module) is the only first-pass difference, and part of it is the
  fixture.** Coding Flow passed 0 of 5 acceptance tests on its first attempt
  (`05-cross-module-B/accept-0.txt`). `/flow-plan` read "paid out" as `approved`
  only, so `submitted` expenses were left out of the totals, and listed that reading
  under *Assumptions* (`run-plan.json`). The prompt supports that reading — the
  totals are "higher than what was actually paid out" (`tasks/05-cross-module/PROMPT.md`),
  and a submitted expense has not been paid out either — and `REFERENCE.md` does not
  settle it; only the third acceptance test ("submitted and approved expenses both
  still count") does. Vanilla read it the grader's way. So this loss says as much
  about an ambiguous prompt as about either arm.
- **What task 5 does show about Coding Flow is independent of who was right.**
  `/flow-plan` settled the ambiguity itself, wrote its reading into the story's
  acceptance criteria, `/flow-run` implemented them, `ai-flow verify` went green
  against them and the story was marked `done` (`run-0.json`). Nothing asked. The
  proof proved the plan, not the request.
- **Task 2:** both arms failed the same 3 of 6 acceptance tests first time and
  passed after one re-prompt (`02-crud-*/accept-*.txt`). No difference.
- **Tests left behind are the one measured edge, and acceptance does not score
  them.** Coding Flow added more spec lines on every task (*Spec lines added*
  column); on task 3, the refactor, vanilla added none.
- **Scope.** Coding Flow made two edits outside where the references place the
  change; vanilla made none. Task 3: it routed `rejectExpense` through a new shared `requireActor`
  helper, without adding the role check, so behaviour is unchanged, ending at 1
  duplicated occurrence against a target of 2 (`03-refactor-B/final.patch`,
  `accept-0.txt`). Task 5: it put the status predicate (`countsTowardTotals`) in
  `approvals.js`, where the reference places the fix in `report.js` only; it kept
  every record, so this is not the audit-trail loss the reference warns about
  (deleting or moving the record) (`05-cross-module-B/final.patch`).
  Neither arm asked about the `rejectExpense` inconsistency.
- **Files forgotten: none, in either arm.** Hand-graded from each `final.patch`
  against each `REFERENCE.md`: every file the reference says should change changed,
  and the tests tasks 2 and 4 require were written.
- **Escaped defects: none found, in either arm.** Hand-graded from the same diffs,
  with the regression suite green in all ten final trees. This is a read of ten
  small diffs by the person who ran them, not a hunt; "none found" is not "none".
  Nothing here shows Coding Flow catching a defect vanilla shipped.

### Deviations from the protocol and limits

- **Files forgotten and escaped defects were graded after the runs**, by hand, from
  the diffs. `final.patch` was exported from the surviving workspaces after the
  fact; everything else in `runs/` is as the runs wrote it.
- **N = 1 per cell, non-deterministic model.** One task is the whole difference in
  first-pass counts; do not read 3/5 against 4/5 as a rate.
- **The task 5 prompt is ambiguous** (see above). A rerun should make the intended
  rule unambiguous in `PROMPT.md` or state it in `REFERENCE.md`.
- **The grader was not blind.** The same person set up, ran and graded both arms.
- **Time** is `duration_ms` summed over the planning session, the run and any
  re-prompt, so arm B pays for `/flow-plan` in every task.
- **Arm B's operator was the harness**: the task prompt was passed to `/flow-plan`
  verbatim, then `/flow-run the story you just planned`. A hand-guided session may
  do better or worse.
- **Arm A was not isolated from the coding-flow plugin.** The plugin is enabled at
  user scope on the machine that ran both arms and no step disabled it for arm A
  (the user's global `CLAUDE.md` and other plugins were present in both arms). Arm
  A never ran `init` and none of its diffs contains a story file; "vanilla" here
  means "not initialised and not invoked", not "absent".
- Tasks ran in parallel, ten sessions at once; timings are indicative only.
- The model was `claude-sonnet-5-5`; a stronger model may change the gap either way.

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
