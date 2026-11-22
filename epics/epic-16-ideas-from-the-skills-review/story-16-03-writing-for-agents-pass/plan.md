# Story 16-03 — Plan

## Implementation Context

- **Execution mode**: QUICK. One measured run and one document; no skill or
  code change.
- **Likely files**: `docs/experiments/reliability-benchmark.md`, and
  `docs/DOGFOODING.md` (the task-5 row).
- **Scout pre-step**: no.
- **Areas to avoid**: `evals/benchmark/fixture/` and `tasks/`. Changing them
  would void the comparison.

## Technical Notes

- The protocol is `docs/experiments/reliability-benchmark.md` §Method:
  1. `node evals/benchmark/run.js setup <task>`;
  2. the headless arm;
  3. `run.js accept <workspace> <task>`.
- Never hand the arm the grader.

## Decisions

- **One run, coding-flow arm only** (maintainer's decision, 2026-11-10, for
  cost). The vanilla numbers from 2026-10-17 are the baseline.
- **No skill text changed**, so no 16-01/16-02 test assertion was touched; the
  `Assumption (unconfirmed):`, Clarify First and `## A Bug Fix Starts Red`
  checks are as they landed. The word budget is untouched.
- **Same model** (`claude-sonnet-5-5`, still available): no successor needed.
- **The plugin under test is this branch** (`--plugin-dir`, installed copy
  disabled for the session, `ai-flow` on `PATH` pointed at this checkout), so
  the run measures 16-01 and 16-02, which the installed 0.14.0 may predate.
- **`Bash` allowed** (`--allowedTools Bash`). The first task-1 attempt without
  it was refused `npm test` by this machine's permission defaults and was
  discarded (trashed): it measured the sandbox. Said in the document.
- **Prompt via stdin.** `claude -p "<prompt>" < /dev/null` read the empty stdin
  as the prompt in 2.1.311; the second attempt's plan and run sessions never
  started (only a re-prompt ran, $0.15) and it was also discarded.
- **Second table pinned by a new test**, under its own
  `summarize-2026-11-14` markers, so the first table's test is unchanged.
- **Re-prompts carry the grader's output**, as in 2026-10-17. Here that output
  answered the plan's open question (tasks 2 and 5); reported as such, not
  counted as the arm asking.
- **No re-run** although cost went up and first-pass went down (spec edge case).

## Acceptance Traceability

- 1–3 → `docs/experiments/reliability-benchmark.md`, review

## Commands

```bash
npm test
```

### Review (2026-11-22, independent reviewer: PASS, 3 P2, all fixed)

- Machine paths in two raw `accept-0.txt` stack traces were rewritten to `/tmp/`
  (the summarizer reads only PASS/FAIL lines; the pinned table is unchanged).
- Task 1's red step is marked self-reported in the write-up and the CHANGELOG:
  the workspace story file and transcript were not kept.
- The cause of the regression is stated as "most likely", with the confounders
  named (N=1, newer `claude` build, `--allowedTools Bash`, sequential tasks).
