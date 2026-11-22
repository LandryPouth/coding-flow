# Reliability benchmark (runs of 2026-10-17 and 2026-11-14)

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

## Second run, 2026-11-14 (coding-flow arm only)

Run 2026-11-14, after the 2026-11-10 prose pass, the `/flow-review` additions and
stories 16-01 (Clarify First rounds, `Assumption (unconfirmed):` keeps an epic
`not ready`) and 16-02 (a bug fix starts red). Same protocol, fixture, prompts and
model as 2026-10-17: `claude-sonnet-5-5` (read back from every run's
`modelUsage`), headless (`-p --output-format json --permission-mode acceptEdits`),
`/coding-flow:flow-plan <prompt>` then `/coding-flow:flow-run the story you just
planned`, then up to 3 re-prompts with the failing `accept` output. **N = 1, one
arm.** The vanilla arm was not re-run: the 2026-10-17 vanilla numbers above are
the baseline, from another day and another `claude` build.

**Deviations from the 2026-10-17 run:**

- `claude` 2.1.311 (was 2.1.302); the plugin was loaded from this branch with
  `--plugin-dir` and the installed copy disabled for the session, and `ai-flow`
  on `PATH` pointed at this checkout.
- `Bash` was allowed (`--allowedTools Bash`). A first attempt at task 1 without
  it stopped on "requires approval" for `npm test` under this machine's
  permission defaults (`permission_denials` 5) and was discarded, not counted:
  it measured the sandbox, not the skills. The 2026-10-17 runs show no denials.
- Tasks ran one after another, not ten at once, so timings are less noisy than
  the first run's and still indicative.
- `final.patch` was written by the run itself (new files staged first), not
  exported afterwards.
- The user-scope `CLAUDE.md` of the machine was present, as in the first run;
  one session (task 5, `run-0`) answered in French because of it.

Raw runs: [`evals/benchmark/runs/2026-11-14/`](../../evals/benchmark/runs/2026-11-14/README.md).
The table is `node evals/benchmark/run.js summarize evals/benchmark/runs/2026-11-14`;
`test/benchmark-results.test.js` pins it too.

<!-- summarize-2026-11-14:begin -->
| Task | Arm | First-pass | Round-trips | Tokens (in/out) | Cache read | Cache write | Cost | Time | Spec lines added |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 fix | coding-flow | yes | 0 | 28/5,937 | 619,713 | 89,846 | $0.48 | 71s | 16 |
| 2 crud | coding-flow | no | 1 | 40/21,416 | 1,153,260 | 126,215 | $1.01 | 231s | 198 |
| 3 refactor | coding-flow | no | 3 | 26/7,308 | 427,977 | 82,666 | $0.93 | 79s | 0 |
| 4 auth | coding-flow | yes | 0 | 16/9,250 | 366,656 | 54,569 | $0.84 | 83s | 110 |
| 5 cross-module | coding-flow | no | 1 | 26/9,138 | 591,503 | 98,480 | $0.71 | 111s | 30 |
| **Total** | coding-flow | 2/5 | 5 | 136/53,049 | 3,159,109 | 451,776 | $3.98 | 575s | 354 |
<!-- summarize-2026-11-14:end -->

Next to the 2026-10-17 coding-flow arm:

| Task | First-pass 10-17 → 11-14 | Cost 10-17 → 11-14 | Time 10-17 → 11-14 |
| --- | --- | --- | --- |
| 1 fix | yes → yes | $0.46 → $0.48 | 75s → 71s |
| 2 crud | no → no | $0.76 → $1.01 | 139s → 231s |
| 3 refactor | yes → **no, never green** | $0.56 → $0.93 | 103s → 79s |
| 4 auth | yes → yes | $0.81 → $0.84 | 96s → 83s |
| 5 cross-module | no → no | $0.78 → $0.71 | 134s → 111s |
| **Total** | 3/5 → 2/5 | $3.36 → $3.98 | 547s → 575s |

Against the 2026-10-17 vanilla arm ($0.97, 217s, 4/5): cost 4.1×, time 2.6×.

### What the second run says

**The lighter skills did not make the arm cheaper, and 16-01 made it stop.** Cost
went up 18 % ($3.36 → $3.98) and first-pass success went down (3/5 → 2/5). The
cause is most likely one behaviour, not the word count — one run (N=1), on a
newer `claude` build (2.1.311 against 2.1.302), with `--allowedTools Bash` added
and the tasks run one after another, so it is not isolated: in three of five tasks `/flow-plan`
wrote an `Assumption (unconfirmed):` line and ended at `not ready`, and
`/flow-run` then refused to implement — exactly what 16-01 asks for, and in a
headless run nobody can answer. Tasks 1 and 4, where the plan wrote no
unconfirmed assumption, passed first time at about the first run's cost.

- **Task 5 (the ambiguity 16-01 was written for): `/flow-plan` stopped at
  `not ready`; it did not settle the ambiguity.** It named the reading it would
  recommend (`approved` only), wrote it as `Assumption (unconfirmed):` with the
  other reading and the question for finance, and said it "did not pick the
  answer myself" (`05-cross-module-B/run-plan.json`). `/flow-run` stopped on that
  line and left the story `planned` (`run-0.json`, `accept-0.txt`: 1 of 5).
  This is the behaviour asked for, and it fails the grader on first pass — both
  are true. On the re-prompt, `/flow-run` took the failing acceptance test as the
  answer ("I treated your acceptance spec as the answer to the open question"),
  replaced the assumption with that decision, set the epic to ready and reached
  green with the grader's reading, `rejected` excluded (`run-1.json`,
  `accept-1.txt`). It said so in its result, but it set the epic to ready on its
  own; the re-prompt carries the grader's output, so this green says the arm
  reads a failing test well, not that it asked the user. **No review ran** in any
  task-5 session, so no `[spec]` finding was raised; the reading was decided by
  the grader, not by a review.
- **Task 3 (refactor): never green.** The plan asked whether `rejectExpense`
  should refuse a role-less actor (the inconsistency the reference puts out of
  scope) and stopped at `not ready`. `/flow-run` refused to implement on all four
  turns, answering each re-prompt "I won't pick a reading from a threshold", so
  the duplication count stayed at its baseline (`03-refactor-B/run-1..3.json`,
  `accept-3.txt`). Three re-prompts were spent on the same question; the protocol
  records it as not reaching green. In the first run, nothing asked about it and
  the task passed.
- **Task 2 (CRUD):** two unconfirmed assumptions (case-insensitive names, who may
  write), `not ready`, nothing written on first pass (0 of 6). The re-prompt was
  read as "go", both stories were implemented and passed: $0.35 for the plan,
  $0.48 for the re-prompt. Tasks 3 (+$0.37) and 2 (+$0.25) are the whole cost
  rise; the other three moved by a few cents.
- **Task 1 (fix): a red reproduction came before the fix (self-reported).** The story records
  "Red before fix (`npm test`): `formatAmount(-1234)` returned `$-12.34`
  (expected `-$12.34`)" before the fix line, and `formatAmount` changed after
  (`01-fix-B/run-0.json`; the story file in the workspace, which is the agent's
  own record — the session transcript was not kept). Cost and time match the
  first run.
- **Task 4 (auth):** passed first time; a fresh agent reviewed the STRICT story
  and found nothing blocking (`04-auth-B/run-0.json`).
- **Spec lines** fell from 417 to 354: task 3 wrote none (124 in the first run),
  tasks 2 and 4 wrote more.

**What to build next follows from this, not from the word count.** An
unattended run that meets an open question has no one to ask; stopping is right
when a person is there, and a dead end when not. Whether a headless `/flow-run`
should take the recommended reading and mark it, or keep stopping, is a product
decision this run cannot make — it only shows the cost of each. Task 3 also
shows `/flow-plan` asking about something the request did not cover; the
recommendation was a scope note, not a blocker.

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
