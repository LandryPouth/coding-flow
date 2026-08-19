# Reliability benchmark — fixture and tasks

The measurement protocol lives in
[`../../docs/experiments/reliability-benchmark.md`](../../docs/experiments/reliability-benchmark.md).
This directory is what it runs against.

## The fixture

`fixture/` is **Ledger**, a small expense-reporting app: eight zero-dependency
CommonJS modules over a transport layer, a domain layer, permissions, and an
aggregate. Its own suite (`npm test`, 17 tests) is **green**.

It is green *and wrong*. Two defects ship in the baseline, neither reachable from
the existing tests:

- `formatAmount` renders a negative amount as `$-12.34`, and drops the sign
  entirely below one unit (`-$0.34` prints as `$0.34`). No test formats a negative.
- The report sums **every** record, including rejected expenses. `report.js`
  predates rejection and `approvals.js` records it correctly; neither file is wrong
  alone. No test rejects an expense and then reads the report.

That is deliberate. A fixture whose suite already catches its bugs measures typing
speed, not reliability.

## The five tasks

| Task | Shape | Where the difficulty is |
|---|---|---|
| `01-fix` | One-file bug | Partial fixes pass the obvious case. `Math.trunc(-0.34)` is `-0`. |
| `02-crud` | Add a resource | The vendor collection must not leak into the expense report. |
| `03-refactor` | Extract a duplicated check | Behaviour must not move. One inconsistent call site is out of scope. |
| `04-auth` | Two permission rules | Enforcement must survive a caller that bypasses the router. |
| `05-cross-module` | Localize a defect | The prompt names a symptom in finance's words and no file. Fix is one line. |

Each task directory holds:

- `PROMPT.md` — given to the arm **verbatim**, identical in both arms. It states a
  symptom or a requirement, never a file or a fix.
- `accept.spec.js` — the grader. Copied in **after** the run, never before: an arm
  that can read the grader writes to the grader.
- `REFERENCE.md` — which files should change, the traps, and what is hand-graded.
- `reference.patch` — a solution that passes. Verified to apply to a clean fixture.

## Running one task

```bash
WORKSPACE=$(node evals/benchmark/run.js setup 05-cross-module)
cat evals/benchmark/tasks/05-cross-module/PROMPT.md
# ... the arm works in $WORKSPACE ...
node evals/benchmark/run.js accept "$WORKSPACE" 05-cross-module
```

`setup` materializes the fixture into a throwaway git repo and commits it, so the
diff at the end is exactly what the arm did. `accept` runs the baseline suite
(regression) and the grader (acceptance), and exits non-zero if either fails.

## Validation of the harness itself

Re-run these two if you change anything here.

| Arm | Expected | Verified 2026-08-19 |
|---|---|---|
| Does nothing | every task fails | 5/5 fail |
| `reference.patch` | every task passes | 5/5 pass, regression green |

The first check is the one that matters: an acceptance test that passes on the
untouched fixture measures nothing. **`03-refactor` is the exception** — a correct
refactor changes nothing observable, so its acceptance file *does* pass on a clean
fixture by construction. Completion there also requires the duplication count to
fall from 4 occurrences to 2, which `accept` reports and fails on.

## Two things the harness cannot grade

Recorded here so they are graded deliberately rather than forgotten.

- **Did the run write a test of its own?** Acceptance is *our* test. A one-line fix
  to a bug that survived a green suite, shipped with no regression test, is the
  exact failure this benchmark exists to measure — and it scores as a pass on
  acceptance alone. `REFERENCE.md` names it per task.
- **Scope.** Tasks 03 and 04 sit next to a related inconsistency the prompt does not
  mention. Noticing and asking is the best outcome; noticing and reporting is
  second; silently changing it is a miss.

## Fairness rules

- Same `PROMPT.md`, same starting commit, same `--model`, both arms.
- The arm never sees `accept.spec.js`, `REFERENCE.md`, or `reference.patch`.
- Arm B is the fixture plus `ai-flow init`. Nothing else is pre-written for it — a
  hand-authored story would be measuring the operator, not the tool.
