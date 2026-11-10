# Story 16-01 — Grilling rounds hold the request

## User Value

When a request can be read two ways, `/flow-plan` asks which reading is
meant, offers its own recommendation, and lets the user accept it in one word.
It never turns its own guess into an acceptance criterion that `verify` later
proves. Without this, a green verify proves the plan, not the request
(benchmark task 5, 2026-10-17).

## Requirements

- `## Clarify First` in `templates/.claude/skills/flow-plan/SKILL.md` asks in
  **rounds**:
  - A round holds at most 4 questions and walks the decision frontier: only
    decisions whose answer changes the implementation, the earlier ones first.
  - Each question opens with its recommended answer, so the user can accept
    it with "yes" or by picking it.
  - Anything the codebase or its docs can answer is looked up, never asked.
  - The budget is unchanged: 5–15 questions, 10–20 for auth, migration,
    billing, permissions or data modelling.
- `### Readiness Gate` gains one rule. An acceptance criterion that rests on
  an interpretation the user did not confirm, where another plausible
  interpretation changes the observable behaviour, either:
  - gets confirmed, or
  - is written as `Assumption (unconfirmed): …` in the story, and the epic
    stays `not ready`.

  When no human can answer (a headless run), the plan stops at `not ready`
  with the question. It never picks the answer.
- `/flow-run`'s `## Stop Conditions` gains one line. A story that carries an
  `Assumption (unconfirmed)` line is not implemented until the user confirms
  it.
- `evals/cases/flow-plan.json` and `evals/cases/flow-run.json` gain the
  routing and anatomy cases this calls for. Tiers 1 and 2 stay green and the
  rank-1 routing rate does not fall.
- `docs/design-decisions.md` gets entry 15, "What was taken from
  `mattpocock/skills`, and what was not". It follows the same shape as entry
  5. It records:
  - the taken items, including those that landed without a story (see the
    epic's `index.md`);
  - the refusals (see the epic's Scope) and the skills already covered here
    (`tdd`, `improve-codebase-architecture`, `setup-ts-deep-modules`);
  - why `git-guardrails` was refused: a Claude Code deny rule covers it in
    one line, while making it a guard feature would mean verifying it on
    every platform;
  - the claim still unverified (see Edge Cases).
- The task-5 row in `docs/DOGFOODING.md` points at this epic in its status
  column.

## Acceptance Criteria

- [ ] Given `flow-plan/SKILL.md`, when `## Clarify First` is read, then it
      asks for rounds of at most 4 questions, each opening with a recommended
      answer, and says that facts the codebase can answer are looked up, not
      asked.
- [ ] Given `### Readiness Gate`, when it is read, then a behaviour-changing
      interpretation the user did not confirm keeps the epic `not ready`, and
      a headless run stops with the question instead of answering it.
- [ ] Given `flow-run/SKILL.md`, when `## Stop Conditions` is read, then a
      story carrying an `Assumption (unconfirmed)` line is not implemented
      until the user confirms it.
- [ ] Given `npm test`, then the skill evals (tiers 1 and 2), `plugin check`
      and the 500-line ceiling pass, and the rank-1 routing rate is not lower
      than before the change.
- [ ] Given `docs/design-decisions.md`, then entry 15 exists, lists the taken
      items and the refused ones, and names the unverified Codex-fork claim.

## Edge Cases

- **Over-asking.** The budget and the stopping rule ("would the next
  question change implementation?") stay. A round with nothing that changes
  the implementation is not asked.
- **A user who answers only "go".** Accepting the recommendations counts as
  confirming them, and the story records them as decisions, not as
  assumptions.
- **An unverified claim.** Pocock says Codex forks the parent conversation
  into its subagents by default. That would break the independence of the
  STRICT review on Codex. Entry 15 lists it as unverified, and this story
  does not change the review.

## Out Of Scope

- A separate `grill-me` skill. The 0.4 consolidation removed it, and a
  section in `/flow-plan` is enough.
- Any CLI change: readiness stays a recorded verdict that `/flow-run` reads.
