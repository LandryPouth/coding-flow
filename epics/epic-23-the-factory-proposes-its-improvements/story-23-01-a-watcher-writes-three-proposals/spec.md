# Story 23-01 — A watcher writes three proposals

## User Value

`/flow-improve`, run in a fresh context, reads the numbers — `ai-flow insights
--all --json` and a sample of raw events — and writes at most three proposals
to improve Coding Flow into the vault, each with its evidence, the concrete
change, the metric that must move and the risk. `ai-flow proposal list` shows
them. It replaces the manual loop of `docs/DOGFOODING.md` (50+ rows written
by hand, from memory, when someone noticed).

## Requirements

- New machinery skill `templates/.claude/skills/flow-improve/SKILL.md`
  (not front door), then `plugin sync`. Input only: `insights --all --json`
  and `ai-flow events sample --n 200 --json` (new, sanitized like vault
  exports); never transcripts, never session reasoning.
- Output: ≤ 3 proposal notes via `ai-flow proposal write --file <json>`
  (validates and writes through `vault.js`):
  frontmatter `title`, `evidence` (metric, value, window, run ids, projects),
  `change` (diff or precise edit list against coding-flow), `success` (metric,
  target, minimum runs), `risk`, `status: proposed`, `kind` (set by 23-02;
  `routine` until then).
- Evidence wording: detections, not proofs ("seen 3 times in 2 weeks, in 2
  projects"); a `success` without minimum runs is refused.
- `ai-flow proposal list [--status]`; `ai-flow proposal accept|refuse <id>
  [--why]` (human), events `proposal.*`.
- The watcher's own cost recorded (`watcher.end` with `total_cost_usd`).
- No vault: proposals go to `.coding-flow/proposals/` with the hint line.

## Acceptance Criteria

- [ ] Given `proposal write` with a 4th proposal in the same pass, then it is
      refused.
- [ ] Given a proposal without `success.minRuns`, then it is refused.
- [ ] Given a written proposal, then `proposal list` shows it with status and
      evidence summary.
- [ ] Given `events sample`, then no field outside the vault allowlist appears.
- [ ] Given the skill, then its prose forbids reading transcripts, it stays
      under 500 lines and an eval checks it produces ≤ 3 valid proposals from
      a fixture insights file.

## Edge Cases

- Nothing worth proposing: the skill writes none and says so; zero is valid.

## Out of Scope

- Classification (23-02), experiments (23-04), automatic scheduling (23-05).
