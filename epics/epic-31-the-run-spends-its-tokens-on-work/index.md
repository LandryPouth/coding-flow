# Epic 31 — The run spends its tokens on work

## Goal

An agent-driven run of Coding Flow spends its tokens on the story, not on
carrying old context and rediscovering the diff. Each fix round starts from a
small brief the tool writes, a reviewer gets the story in one bounded read,
plans that would run for many rounds are split before any code is written, and
the run says what each story cost.

## Why

The maintainer asked for this on 2026-11-25: Coding Flow started as a
token-efficient tool, and a code factory must not change that. The figures
come from the unattended run of 2026-11-14 to 11-25: 148 agent transcripts,
measured from their `usage` fields.

| | Agents | Input tokens | Per agent | Context per turn |
|---|---|---|---|---|
| Implementers | 32 | 1.31 B (75 %) | 41 M | ~220 k |
| Reviewers | 112 | 0.40 B | 3.6 M | ~87 k |

- **Implementers cost the most** because the same agent is resumed for every
  fix round, and its context grows to the compaction limit. Every later turn
  re-reads that context. 29-04 alone cost 147 M input tokens over 655 turns;
  19-05, 19-08, 26-06 and 29-03 cost 95 to 111 M each.
- **Rounds multiply everything.** There were 112 reviews for about 30 stories.
  The stories that needed 6 to 8 rounds (19-05, 19-08, 29-03, 29-04, 26-06)
  all promised something about an open input space: any shell command, any
  test file, any reformat. Each was re-scoped late to a monotonic claim, such as
  "never weaker than base, on a recorded corpus", and passed after that.
  Criteria counts do not tell these stories apart: 19-09 had 7 criteria and
  passed in one round.
- **The tool's own output is not the problem.** `verify` and test output were
  1 M of the 13 M characters returned by shell calls. Exploration was 8 M
  (`grep`, `sed`, `cat`) and 3.9 M (`git diff`, `log`, `show`).

## Scope

**In scope**

- `ai-flow story brief`: a deterministic handoff for a fresh implementer.
- `ai-flow review pack`: one bounded read for a reviewer.
- `flow-plan` and `doctor` flag open-world promises in STRICT stories before
  any code is written.
- The `flow-run` and `flow-review` skills, and the epic-run guidance, use these
  tools.

**Out of scope**

- Model choice per role. That is the harness's setting, not Coding Flow's.
- Prompt caching knobs.
- A daemon or a resident index of the code (design-decisions entry 2).
- Measuring runs: tokens per story, budgets and transcripts. That moved to
  epic 32, the maintainer's bench, which sits outside the tool. The maintainer
  decided this on 2026-11-25: "le bench reste pour moi et pas pour l'outil".
  Story 31-04 became 32-01.

Backbone: a story fails review → the fix starts from a brief → the reviewer reads one pack → the plan is split before code

```text
s1
├── s2
└── s3
```

s2 reuses s1's reader of the review findings recorded in `plan.md`. s3 changes
`flow-plan` and `doctor` only. Their likely files are disjoint, so s2 and s3 can
run in parallel after s1. Epic 32 measures this epic's gains.

## Stories

1. [story-31-01-a-fix-round-starts-from-a-brief](story-31-01-a-fix-round-starts-from-a-brief/spec.md) *(STANDARD — walking skeleton: the brief command, the findings section it reads, and the skills that start a fresh implementer from it)*
2. [story-31-02-the-reviewer-reads-one-pack](story-31-02-the-reviewer-reads-one-pack/spec.md) *(STANDARD)*
3. [story-31-03-an-open-promise-is-split-before-code](story-31-03-an-open-promise-is-split-before-code/spec.md) *(STANDARD)*

## Readiness

ready. The figures above are measured, not assumed. The open choices are
recorded as decisions in each story's plan.

## Execution

In the unattended run, this epic comes right after wave 2 (see
`docs/plans/autonomous-run.md`). Until s1 lands, the run applies its rule by
hand: each fix round gets a fresh implementer, briefed from the story files.
