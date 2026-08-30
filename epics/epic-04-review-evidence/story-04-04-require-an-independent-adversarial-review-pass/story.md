# Story 04-04 — Require an independent, adversarial review pass in STRICT

The one `/flow-review` pass STRICT already requires becomes genuinely
independent (a fresh subagent, not the authoring session re-reading its own
reasoning) and defaults to Deep on the dimensions the diff's own risk already
flagged — without adding parallel-subagent fan-out. Prose-only change to two
skill files and their synced copies; no runtime code.

*(QUICK — `skills/flow-review/SKILL.md`, `skills/flow-run/SKILL.md`, and
their `templates/.claude/skills/` source-of-truth copies only.)*

## Acceptance Criteria

- [x] Given `flow-run/SKILL.md`'s "Review Before Done" STRICT line, when read,
      then it explicitly instructs delegating to a fresh Agent/subagent call
      handed the diff, the contract (acceptance criteria, `RULES.md`,
      conventions), and the fact that this diff's risk tier already resolved
      STRICT — nothing else beyond that, never the authoring session's own
      reasoning or conclusion — framed adversarially ("find what's wrong,
      assume the author is overconfident"). The risk-tier fact is included
      because `flow-review`'s Deep-by-default clause (AC2) is conditioned on
      the reviewer already knowing the calling context resolved STRICT; a
      fresh subagent handed only the diff and contract has no way to know
      that unless told, so omitting it would make AC2 unreachable through
      delegation.
- [x] Given `flow-review/SKILL.md`'s dimension-selection guidance, when the
      calling context's own risk tier is already STRICT (`scoreDiffRisk`/
      `scoreStoryRisk` resolved `high`), then Architecture, Tests, and
      Security default to their Deep sections without requiring the reviewer
      to re-judge risk.
- [x] Given a QUICK/STANDARD diff, when the same dimension-selection step is
      read, then the quick checklist remains the stated default — this story
      does not raise the bar for lower tiers.
- [x] Given `templates/.claude/skills/flow-review/SKILL.md` and
      `templates/.claude/skills/flow-run/SKILL.md` (source of truth), when
      `ai-flow plugin sync` runs, then `skills/flow-review/SKILL.md` and
      `skills/flow-run/SKILL.md` carry the identical updated language —
      verified by `test/ceremony.test.js`-style content assertions (grep-based,
      matching this repo's existing precedent for testing skill prose).
- [x] Given this epic's Decisions record why parallel multi-subagent fan-out
      is explicitly not the default here, when read, then that reasoning
      (cost multiplies roughly per added dimension; structural checks and
      independence close the cheapest misses first; `/code-review ultra`
      remains available as an explicit, separate path) is stated in the
      skill text itself, not only in the epic's own planning docs — so a
      future reader of the skill understands the boundary without needing
      the epic history.

## Commands

```bash
npm test
```

## Status: done

## Result

`templates/.claude/skills/flow-run/SKILL.md`'s "Review Before Done" STRICT line now
explicitly instructs delegating the pass to a fresh Agent/subagent call, handed the
diff, the contract (acceptance criteria, `RULES.md`, existing conventions), and the
fact that this diff's risk tier already resolved STRICT — nothing else beyond that,
never the authoring session's own reasoning or conclusion — framed adversarially
("find what is wrong with this change, assume the author is overconfident").

The risk-tier fact was added after an independent review of this story caught that
the original "diff and the contract ... only" wording left a delegated subagent no
way to know the calling context had resolved STRICT, which made `flow-review`'s
Deep-by-default clause (below) unreachable through delegation — the subagent had no
way to derive that fact from the diff and contract alone, only to be told.

`templates/.claude/skills/flow-review/SKILL.md`'s Overview now states that when the
calling context's own risk tier already resolved STRICT (`scoreDiffRisk`/
`scoreStoryRisk` returned `high`), Architecture, Tests, and Security default to their
Deep sections without the reviewer re-judging risk; a QUICK/STANDARD diff is
explicitly called out as unaffected, keeping the quick checklist the stated default
there. The same paragraph states why this scales depth-per-dimension inside one
independent pass rather than parallel subagent fan-out (cost multiplies roughly per
added subagent context; the cheapest misses are already closed by structural checks
and one genuinely independent pass), with `/code-review ultra` named as the explicit,
separately-invoked path for extra parallel coverage — moving the epic's "no
parallel-subagent default" Decision into the skill text itself.

`ai-flow plugin sync` copied both edited files from `templates/.claude/skills/` into
`skills/`; `skills/flow-run/SKILL.md` and `skills/flow-review/SKILL.md` are byte-
identical to their source-of-truth copies (already covered by the pre-existing "the
plugin and the scaffold ship the same skills" test).

Four new grep-based content assertions were added to `test/ceremony.test.js`,
matching its existing precedent for testing skill prose: the subagent-delegation/
adversarial-framing language in `flow-run`, the STRICT-defaults-to-Deep language in
`flow-review`, and the no-parallel-fan-out language in `flow-review`.

### Tests And Validation

- `node --require ./scripts/test-env-guard.js --test test/ceremony.test.js` — 12/12
  passing (4 new).
- `ai-flow verify --story epics/epic-04-review-evidence/story-04-04-require-an-independent-adversarial-review-pass`
  — green (`npm test`, `node scripts/check-lock-exit-reachability.js`).
  `Coverage: evidence` (12 test files alongside 13 behavior files — the two edited
  `SKILL.md` files plus `ai-flow plugin sync`'s output; no lcov report exists for
  markdown prose, so `evidence` is the honest ceiling here, not `verified`).

### Rollback Notes

Prose-only change to two `SKILL.md` files (plus their synced plugin copies) and one
test file; `git revert` is sufficient. No runtime code, no migration, no feature
flag.

