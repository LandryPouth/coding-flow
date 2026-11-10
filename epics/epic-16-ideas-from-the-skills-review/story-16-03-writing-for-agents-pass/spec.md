# Story 16-03 — Measure what the lighter skills cost and catch

## Prior Work

**The prose pass already landed without this story** (2026-11-10, at the
maintainer's request). The eight skills went from 15,070 words to 11,472,
with `/flow-run` going from 3,944 to 2,649. `RULES.md` went from 898 words
to 707. Descriptions are unchanged, and the rank-1 routing rate held at
83.3 %. An independent read of the diff found no high-severity loss; its medium and low findings were restored the same day. What this story still owns is the paid measurement: whether the pass,
the `/flow-review` additions and stories 16-01 and 16-02 changed cost or
first-pass success.

## User Value

Every session pays for the skill text an agent reads. Words were cut on the
assumption that efficacy holds. That holds only once a real run shows it.

## Requirements

- **One paid measure**, after 16-01 and 16-02 have landed: a single run of
  the coding-flow arm of `evals/benchmark` on the five tasks, with the
  protocol and model of the 2026-10-17 run. It records:
  - first-pass success, cost (`total_cost_usd`) and time;
  - for task 5, whether `/flow-plan` asked, stopped, or settled the
    ambiguity itself, and whether the review raised a `[spec]` finding;
  - for task 1, whether a red reproduction came before the fix.

  The results go into `docs/experiments/reliability-benchmark.md` as a
  second dated run, next to the 2026-10-17 numbers, with the N=1 caveat. The
  vanilla arm is not re-run.
- Any later skill edit keeps the word budget. A skill that grows by more
  than 10 % over the post-pass count needs a reason in its commit.

## Acceptance Criteria

- [ ] Given `docs/experiments/reliability-benchmark.md`, then a second dated
      run reports first-pass success, cost and time for each task, next to
      the 2026-10-17 numbers, with the N=1 caveat.
- [ ] Given task 5 of that run, then the document says whether `/flow-plan`
      asked, stopped at `not ready`, or settled the ambiguity, and whether
      the review raised a `[spec]` finding. The DOGFOODING task-5 row is
      updated to match.
- [ ] Given task 1 of that run, then the document says whether a red
      reproduction came before the fix.

## Edge Cases

- **The cost goes up.** Report it as measured. Never re-run until the
  number looks better.
- **Headless task 5.** In headless mode, nobody can answer the plan's
  question. A plan that stops at `not ready` fails the grader on first
  pass, yet it is the behaviour asked for. Report both facts.
- **Model drift.** If the 2026-10-17 model is no longer available, use its
  successor, name it, and treat the comparison as weaker.

## Out Of Scope

- A tier-3 behavioural eval suite (refused, entry 5).
- Re-running the vanilla arm, or running more than one run per cell.
