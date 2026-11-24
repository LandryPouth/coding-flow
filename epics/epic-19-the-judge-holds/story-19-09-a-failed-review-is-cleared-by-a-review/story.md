# Story 19-09 — A failed review is cleared by a review

> STANDARD · added 2026-11-24 at the maintainer's request · ahead of 20-04

## Why

A review can PASS, and a second, independent review of the same story then
FAIL. After a FAIL, the fixes are made and a green `verify` is easy to take as
the end — but verify proves the tests, not that the findings are closed, and
the fixer judging their own fix is the weakest check there is. The maintainer
wants a FAIL cleared only by a new review round. The epic-run skill already
does this (step 4b); Coding Flow itself does not: today a `pass` can be
captured right after a `fail` with nothing in between.

20-04 will run rounds automatically (fresh reviewer each round, two clean
rounds for STRICT, a cap). This story is the small guard that holds until
then, and the field 20-04 builds on.

## What changes

- `ai-flow review capture --verdict pass` on a story whose latest captured
  review is `fail` is refused unless it declares a new round:
  `--round <n>` with `n` = the failed review's round + 1 (a review captured
  without `--round` counts as round 1). The message says why: "a failed review
  is cleared by a new review of the whole diff, not by verify alone", and
  gives the command.
- The pass records `round` and `after` (the failed review's evidence file),
  so `status --json` shows the history ("pass, round 2, after a fail"), with
  the passing rounds in a row since the last fail and whether a fail came
  before. The PR body does not show reviews today; that stays with 20-04
  (Decisions).
- A STRICT story (risk from the diff) needs two consecutive passing rounds
  after a fail before its review counts as clean in `status`; the first is
  shown as "pass — one more round required (STRICT)".
- `--accept "<reason>"` still lets the user accept the risk, recorded.
- `flow-review` and `flow-run` skills: one paragraph — after a FAIL, fix every
  finding, then run a NEW review (fresh reviewer, whole diff, blind first,
  then the previous list); never conclude on verify alone. Same wording as
  20-04's spec so the two agree.

## Acceptance Criteria

- [x] Given a story whose latest review is `fail`, when `review capture
      --verdict pass` runs without `--round`, then it exits non-zero, writes
      no evidence, and the message names the rule and the command.
- [x] Given the same story, `--verdict pass --round 2` is captured, records
      `round: 2` and `after: <fail evidence>`, and `status --json` shows it.
- [x] Given `--round 3` right after a round-1 fail (a skipped number), then
      it is refused.
- [x] Given a STRICT story, a first passing round after a fail leaves its
      review not clean in `status`; a second consecutive pass makes it clean;
      a fail in between restarts the count.
- [x] Given a story with no failed review, `review capture --verdict pass`
      behaves exactly as before (no new flag required).
- [x] `--accept "<reason>"` captures a pass after a fail without a round, and
      the reason is stored.
- [x] The two skills carry the paragraph; `plugin sync` run, `plugin check`
      green, evals updated in the same commit. (Evals: no change — the
      descriptions they read did not change; see Decisions.)

## Out of scope

- Running the reviewers, counting P1 per round, the round cap and
  `review-not-converging`: 20-04.
- Telling whether the reviewer was really new: the tool records what it is
  told; the skills carry the rule.
- Renaming or moving a story directory: its review history is keyed by the
  story path, so the moved story starts again at round 1 with no history.
- Review evidence written in a worktree whose `.coding-flow/runs/` is
  gitignored does not come back with the land (until 18-02, proof survives the
  land); the rounds are then read on the worktree only.

## Tasks

- [x] Refusal, `--round`, `after`, STRICT two-round count, `--accept`.
- [x] `status --json` shows round and history (PR evidence: see Decisions).
- [x] Skills paragraph, `plugin sync` (evals: see Decisions).
- [x] Run `npm test`, then `ai-flow verify --story <this story>`, the review
      the mode requires, and add a CHANGELOG entry (Behaviour changes).

## Decisions

- **Every capture is a round.** `round` is recorded on every capture, the
  previous round + 1 by default (a file from before rounds reads as round 1),
  so 20-04 finds the series already numbered. `--round` is a declaration that
  must equal that next number; only a pass right after a fail *requires* it.
  A declared number that skips or repeats is refused, whatever the verdict.
- **`after` is the evidence file** (`.coding-flow/runs/<name>-review.json`),
  the path from the project root, recorded only on a pass that clears a fail.
- **STRICT confirmation is a status, not a refusal.** The second clean round
  cannot be refused at capture time (the first one is legitimate); `status`
  shows `confirming` (text: `pass — one more round required (STRICT)`), and
  `next` and the chain gate (`review-unconfirmed`) treat it as not yet clean.
  STRICT is the story's risk as `status` already scores it
  (`computeReviewRequired`), never a second model. A pass the user accepted
  (`acceptedRisk`) is not held back.
- **The latest review is still chosen as before** (the first file with the
  latest timestamp); the history only adds the run of passes since the last
  fail.
- **PR evidence unchanged.** The PR body renders verify evidence only — no
  review appears there today. Adding reviews to it is a new surface; 20-04
  records `review.round` events and owns that. `status --json` carries the
  history now.
- **Evals unchanged.** The skill descriptions did not change, and trigger
  evals only read descriptions; the new paragraphs are body text.
- **One existing test's setup follows the new rule.**
  `test/review.test.js` "latestReviewByStoryDir returns only the latest
  capture…" captured a pass right after a fail; that pass now declares
  `--round 2`. Its assertion (the later pass wins) is unchanged.
- **An accept says what it covers** (`acceptedFor`: `open-findings`,
  `round`, or both). Only an accept of the missing round lets a STRICT pass
  skip its confirming round; accepting a P1 does not. A reason recorded before
  this reads as `open-findings`.
- **Both refusals at once.** A pass with an open P1 right after a fail without
  a round names both gaps in one message.
- **`--round` is a plain whole number** (`/^\d+$/`): `0x2` or `2e0` would
  otherwise read as 2.
- **20-04's STRICT wording aligned** (review, 2026-11-24): two consecutive
  clean rounds by fresh reviewers, the second under another lens — the
  epic-run rule — replacing "the confirming round a single generalist
  reviewer" in its spec.
- **Who reviewed is not checked.** The tool records what it is told; the
  fresh-reviewer rule lives in the skills (Out of scope).

## Acceptance Traceability

1. test/review-rounds.test.js::a pass right after a failed review, without a new round, is refused and writes nothing; test/review-rounds.test.js::a pass after a fail with an open P1 and no new round names both refusals
2. test/review-rounds.test.js::a pass declared as the next round is captured with its round and the failed review it clears; test/review-rounds.test.js::status --json keeps the history visible: passes in a row since the last fail, and whether a fail came before; test/review-rounds.test.js::the plain output names the round
3. test/review-rounds.test.js::a round that skips a number is refused; test/review-rounds.test.js::--round takes only a plain whole number
4. test/review-rounds.test.js::a STRICT story needs two consecutive passing rounds after a fail; a fail in between restarts the count; test/review-rounds.test.js::an --accept for open findings does not skip the STRICT confirming round; one for the round itself does; test/next.test.js::next holds a STRICT story whose only clean review round follows a fail, then lets it ship after a second; test/worktree-autoland.test.js::auto-land: a STRICT-tier chain whose only clean review round follows a fail blocks with reason "review-unconfirmed"
5. test/review-rounds.test.js::with no failed review, a pass needs no new flag, and each capture is the next round
6. test/review-rounds.test.js::--accept captures a pass after a fail without a round, and stores the reason
7. test/plugin.test.js::plugin check confirms skills/ <-> templates parity (`plugin check`: generated skills match templates) — the paragraph itself is prose, read in `templates/.claude/skills/flow-review/SKILL.md` (Output) and `flow-run/SKILL.md` (Review Before Done)

## Status: done

## Result

Done 2026-11-24. `review capture` refuses a pass right after a fail without
`--round` (or `--accept`, which records what it covered); every capture
records its round; `status --json` shows `reviewRound`, `reviewAfter`,
`reviewCleanInARow`, `reviewHadFail`; a STRICT story is `confirming` in
`status`, `next` and the chain gate (`review-unconfirmed`) until two passing
rounds in a row. `flow-review` and `flow-run` carry the new-round paragraph;
20-04's STRICT wording aligned.

- Review: 1 round (fresh subagent reviewer), PASS — 0 P0, 0 P1, 8 P2, all
  fixed (Decisions). P1 per round: 0.
- `npm test`: 1782 pass. Verify green (3 commands), evidence
  `.coding-flow/runs/2026-11-24T19-34-07-627Z-verify.json`; coverage not
  required (risk low). Verify warns that criterion 7's wording changed (the
  evals note).
- Commits: 22d8f76, f72fc83, 749efe1, and the closing commit.

### Rollback Notes
