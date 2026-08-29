# Story 04-04 — Require an independent, adversarial review pass in STRICT

The one `/flow-review` pass STRICT already requires becomes genuinely
independent (a fresh subagent, not the authoring session re-reading its own
reasoning) and defaults to Deep on the dimensions the diff's own risk already
flagged — without adding parallel-subagent fan-out. Prose-only change to two
skill files and their synced copies; no runtime code.

*(QUICK — `skills/flow-review/SKILL.md`, `skills/flow-run/SKILL.md`, and
their `templates/.claude/skills/` source-of-truth copies only.)*

## Acceptance Criteria

- [ ] Given `flow-run/SKILL.md`'s "Review Before Done" STRICT line, when read,
      then it explicitly instructs delegating to a fresh Agent/subagent call
      handed the diff and the contract (acceptance criteria, `RULES.md`,
      conventions) only — never the authoring session's own reasoning or
      conclusion — framed adversarially ("find what's wrong, assume the
      author is overconfident").
- [ ] Given `flow-review/SKILL.md`'s dimension-selection guidance, when the
      calling context's own risk tier is already STRICT (`scoreDiffRisk`/
      `scoreStoryRisk` resolved `high`), then Architecture, Tests, and
      Security default to their Deep sections without requiring the reviewer
      to re-judge risk.
- [ ] Given a QUICK/STANDARD diff, when the same dimension-selection step is
      read, then the quick checklist remains the stated default — this story
      does not raise the bar for lower tiers.
- [ ] Given `templates/.claude/skills/flow-review/SKILL.md` and
      `templates/.claude/skills/flow-run/SKILL.md` (source of truth), when
      `ai-flow plugin sync` runs, then `skills/flow-review/SKILL.md` and
      `skills/flow-run/SKILL.md` carry the identical updated language —
      verified by `test/ceremony.test.js`-style content assertions (grep-based,
      matching this repo's existing precedent for testing skill prose).
- [ ] Given this epic's Decisions record why parallel multi-subagent fan-out
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

## Result

