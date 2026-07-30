# Reliability benchmark (in progress)

Coding Flow claims to make Claude Code **more reliable**: less context burned,
fewer forgotten files, and higher first-pass success because the machine verifies
instead of the agent asserting. That claim is currently **unvalidated by data** —
this document is the harness to validate (or refute) it. Numbers below are
**pending**; do not cite them until the runs are done. Do **not** fill this table
with estimates.

## Hypothesis

For real, non-trivial tasks, `Claude Code + Coding Flow` beats `Claude Code alone`
on first-pass success and forgotten-file rate, at comparable or lower token cost.

## Method

Run each task twice, from the same clean starting commit, in separate sessions:

- **A — vanilla:** Claude Code with a normal `CLAUDE.md`, free conversation.
- **B — coding-flow:** the same repo scaffolded with `init`, driven via `/plan-epic`
  → `/run-story`.

Same prompt wording for the user-facing objective in both arms. Blind the grader
to the arm where feasible.

### Tasks (5, escalating)

1. **Fix** — a one-file bug / copy fix.
2. **CRUD** — add a resource with list/create/edit and its tests.
3. **Refactor** — extract a shared module used in 3+ places, no behavior change.
4. **Auth feature** — a permission-gated action with server-side enforcement.
5. **Cross-module bug** — a defect whose root cause spans 2+ modules.

### Metrics (per task, per arm)

| Metric | How measured |
| --- | --- |
| First-pass success | Task's acceptance check passes with no human correction |
| Round-trips | Number of user corrections/re-prompts to reach green |
| Tokens | Total input+output tokens for the session |
| Files correct / missed | Files that should have changed vs. those actually changed |
| Time to green | Wall-clock from first prompt to passing acceptance |

## Results (PENDING — do not fill with estimates)

| Task | Arm | First-pass | Round-trips | Tokens | Files missed | Time |
| --- | --- | --- | --- | --- | --- | --- |
| 1 Fix | vanilla | — | — | — | — | — |
| 1 Fix | coding-flow | — | — | — | — | — |
| 2 CRUD | vanilla | — | — | — | — | — |
| 2 CRUD | coding-flow | — | — | — | — | — |
| 3 Refactor | vanilla | — | — | — | — | — |
| 3 Refactor | coding-flow | — | — | — | — | — |
| 4 Auth | vanilla | — | — | — | — | — |
| 4 Auth | coding-flow | — | — | — | — | — |
| 5 Cross-module | vanilla | — | — | — | — | — |
| 5 Cross-module | coding-flow | — | — | — | — | — |

## Honesty rules

- LLM runs are non-deterministic and N is small: treat results as **indicative**,
  not proof. Report the raw runs, not a cherry-picked best.
- If coding-flow is equal or worse on a task, **say so** here — a negative result
  is the point of running the experiment.
- Publish the task repos / prompts so the numbers are reproducible.
