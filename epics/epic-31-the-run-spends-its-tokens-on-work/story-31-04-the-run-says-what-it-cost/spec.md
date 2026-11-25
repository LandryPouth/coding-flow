# Story 31-04 — The run says what it cost

## User Value

The maintainer sees what each story cost in tokens and rounds, and which role
spent them, without writing a script over transcripts by hand as on 2026-11-25.
A story that runs past a budget is flagged while it runs, not found in a
post-mortem.

## Requirements

- **`ai-flow cost [--story <dir>] [--since <date>] [--json]`** reads the
  Claude Code transcripts of this project, and only this project's:
  `~/.claude/projects/<project-key>/**/subagents/*.jsonl` and their
  `.meta.json`. It sums the `usage` fields per agent:
  - input, cache read, cache write and output tokens;
  - turns, and context per turn.

  An agent is assigned to a story by the story id in its description (`NN-MM`)
  and to a role by the words in it (implement or fix, review or round, other).
  An agent with no story id is reported as "unassigned".
- **The report.** One line per story: total input tokens, implementer share,
  number of review agents, and the largest single agent. Then totals per role,
  and the five most expensive agents.
- **A budget.** `run.storyTokenBudget` (default 60 M input tokens) and
  `run.agentContextWarn` (default 150 k context per turn). `status` and `next`
  show a story over either one as `over budget`. That is a warning, never a
  block.
- **Privacy.**
  - It is read-only, and reads only this project's folder.
  - It prints numbers and agent descriptions, never message content.
  - Nothing is written to the vault or `.coding-flow/` unless asked (`--save`
    writes an aggregate JSON to `.coding-flow/runs/`).
- **No transcripts found** (another platform, or none yet): it says so and
  exits 0.

## Acceptance Criteria

- [ ] Given fixture transcripts for two stories (one implementer resumed over
      3 rounds, 4 reviewers), when `ai-flow cost` runs, then it prints per story
      the totals, the implementer share and the review count, plus totals per
      role. The numbers equal the sums of the fixtures' `usage` fields.
- [ ] Given a story over `run.storyTokenBudget`, then `status` shows it
      `over budget` and exits as it did before.
- [ ] Given transcripts of another project in a sibling folder, then they are
      not read.
- [ ] Given no transcript folder, then it says so and exits 0.
- [ ] Given `--json`, then the same numbers are printed, and the output
      contains no message text from the fixtures. The test checks this with a
      marker string.

## Edge Cases

- Truncated JSONL lines: skipped and counted.
- One agent's description that names two stories: assigned to the first one,
  and noted.
- The project key: Claude Code's folder name, derived from the absolute path
  with `/` replaced by `-`. Checked against what is on disk, never assumed.

## Out of Scope

- Cost in money. Prices change, and tokens are the stable unit.
- OpenCode, Codex and other platforms, until their transcript format is seen
  on disk (design-decisions entry 10).
