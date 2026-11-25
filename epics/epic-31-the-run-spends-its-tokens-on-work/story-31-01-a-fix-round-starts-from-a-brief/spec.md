# Story 31-01 — A fix round starts from a brief

## User Value

When a review fails, the fix is done by a fresh agent that reads a short brief
written by the tool. It no longer comes from the same agent, resumed with every
earlier round still in its context. A fix round then costs about what a first
pass costs: the run's implementers averaged ~220 k tokens of context per turn,
against ~87 k for reviewers, who always start fresh.

## Requirements

- **Findings are written down.** A failed review's findings go under
  `## Review findings` in the story's `plan.md`, or `story.md` for a one-file
  story, one subsection per round: `### Round N — FAIL|PASS (<lens>)`. Each
  finding is one checkbox line: `- [ ] P1 <file:line> — <what> — fix: <how>`.
  The implementer ticks a finding when it is fixed, or marks it `[~]` with the
  reason when it is declined.
- **`ai-flow story brief <story-dir|--story>`** prints a deterministic,
  bounded handoff (default budget 6,000 characters; `--budget`, `--json`).
  In priority order:
  1. the story's path, risk and status, its start commit, and the worktree;
  2. each acceptance criterion with its state;
  3. the `## Decisions` lines from the plan;
  4. the open findings of the latest round, in full, followed by a count of
     the closed ones;
  5. the files changed since the start commit, with line counts, excluding
     what merged-in base commits brought;
  6. the last verify: green or red, the coverage rung, and the names of the
     failing tests;
  7. the open `## Human to-do` lines.

  When the budget is reached, the lowest-priority sections are cut first, and
  the brief says what it cut. It never cuts an open finding: if those alone
  are over the budget, the brief says so and lists every one.
- **Skills.** `flow-review` writes its findings in that format. `flow-run`
  says that a fix round starts by reading `ai-flow story brief`, then only the
  files the findings name. The epic-run guidance in `docs/` says to start a
  fresh implementer for each fix round, briefed with the brief's output, and
  never to resume the previous one.

## Acceptance Criteria

- [ ] Given a story with two review rounds in `plan.md`, when
      `ai-flow story brief` runs, then it prints the latest round's open
      findings in full and a count of the closed ones, the criteria with their
      state, the decisions, the files changed since the start commit and the
      last verify's result.
- [ ] Given a story branch that merged the base twice, then the
      changed-files list holds only the story's own changes, not the files
      the merges brought.
- [ ] Given `--budget 1500` on a large story, then the output stays under
      1,500 characters and names the sections it cut. Given open findings
      longer than the budget on their own, then every open finding is still
      printed and the overflow is stated.
- [ ] Given the same story twice, then the two outputs are byte-identical, and
      `--json` holds the same content.
- [ ] `flow-review` and `flow-run` carry the paragraphs above, `plugin sync`
      has been run, and their eval cases cover writing findings as checkbox
      lines and starting a fix from the brief.

## Edge Cases

- A story with no review yet: the brief has no findings section and says
  "no review recorded".
- A one-file story (`story.md`): findings live there.
- Findings written as prose in an older story: not parsed. The brief says that
  the latest round has no checkbox findings, and `doctor` warns about it.
- A verify evidence missing or stale: the brief says so instead of reporting
  green.

## Out of Scope

- Writing the brief with a model.
- The reviewer's view, which is story 31-02.
