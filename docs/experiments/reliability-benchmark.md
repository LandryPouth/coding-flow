# Reliability benchmark (harness ready, runs pending)

Coding Flow claims to make Claude Code **more reliable**: fewer forgotten files and
higher first-pass success, because the machine verifies instead of the agent
asserting. That claim is **unvalidated by data**. This document is the harness to
validate or refute it.

Numbers below are **pending**. Do not cite them, and do not fill the table with
estimates — a tool whose thesis is *"executed proof beats assertion"* cannot ship an
asserted benchmark.

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

## Results (PENDING — do not fill with estimates)

| Task | Arm | First-pass | Round-trips | Tokens (in/out) | Cache read | Cost | Files missed | Time |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 Fix | vanilla | — | — | — | — | — | — | — |
| 1 Fix | coding-flow | — | — | — | — | — | — | — |
| 2 CRUD | vanilla | — | — | — | — | — | — | — |
| 2 CRUD | coding-flow | — | — | — | — | — | — | — |
| 3 Refactor | vanilla | — | — | — | — | — | — | — |
| 3 Refactor | coding-flow | — | — | — | — | — | — | — |
| 4 Auth | vanilla | — | — | — | — | — | — | — |
| 4 Auth | coding-flow | — | — | — | — | — | — | — |
| 5 Cross-module | vanilla | — | — | — | — | — | — | — |
| 5 Cross-module | coding-flow | — | — | — | — | — | — | — |

Model: _record here_ · Date: _record here_ · coding-flow version: _record here_

## What is still missing before a run

Only one thing, and it is a product decision rather than an engineering one: the
**fixture repo and the five prompts**. Everything downstream — measurement, the
re-prompt protocol, the acceptance grading — is settled above. Pick a repo real
enough that task 5 can genuinely span two modules; a toy app makes every arm win.

## Honesty rules

- LLM runs are non-deterministic and N is small: results are **indicative**, not
  proof. Report the raw runs, not a cherry-picked best.
- If coding-flow ties or loses on a task, **say so here**. A negative result is the
  point of running the experiment, and publishing one is worth more to this tool's
  argument than a win it cannot show.
- Publish the fixture repo and the verbatim prompts so the numbers are reproducible.
