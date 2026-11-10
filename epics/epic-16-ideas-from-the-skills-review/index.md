# Epic 16 — Three measured ideas from mattpocock/skills

## Goal

`/flow-plan` asks the questions whose answer changes the behaviour, each one
with a recommendation, and does not settle an ambiguity in silence. A bug fix
starts from a red reproduction in every mode. The skills lose the prose that
changes nothing. One benchmark run says whether this worked.

## Why

mattpocock/skills was reviewed on 2026-11-10, against the same bar as
`addyosmani/agent-skills` (design-decisions entry 5). The verdict was the
same: a skills layer is a commodity, and nothing in that repository can fail.
Three ideas are worth taking anyway, because each one targets a failure that
was measured here:

- **`grilling`**: questions asked in rounds over the decision frontier, each
  with a recommended answer, and facts looked up rather than asked. This
  targets the open `high` row in `docs/DOGFOODING.md` from the 2026-10-17
  benchmark, task 5. There `/flow-plan` turned an ambiguity into acceptance
  criteria, `verify` went green, and nobody was asked: "the proof proved the
  plan, not the request". Epics 13–15 do not cover it. Our own `grill-me`
  went away in the 0.4 consolidation (`c0bb189`), and it took the opposite
  stance: the fewest questions, one per turn.
- **`diagnosing-bugs`, phase 1**: build a loop that can go red before forming
  any hypothesis. `--red-at-base` exists, but `/flow-run` asks for it only
  under STRICT, and most bug fixes are QUICK.
- **`writing-for-agents`** as an audit lens. It hunts no-op sentences,
  negations that name the wrong action, and sprawl. The benchmark measured
  coding-flow at about 3.5× the cost of the agent alone.

These stay inside the freeze. All three are prose plus their evals, and none
adds a command.

**Already landed without a story** (2026-11-10, the maintainer's call, being
small):

- in `/flow-review`, from `code-review`, `codebase-design` and `retro`:
  - a `[spec]` pass against the request;
  - "a mechanical finding ships its check";
  - the deletion test and "one adapter is a hypothetical seam";
  - eight of Fowler's smells;
- in `/flow-plan`, from `prototype`: one paragraph on throwaway prototypes;
- the `writing-for-agents` pass itself, on all eight skills and `RULES.md`,
  which cut them by a quarter (numbers in story 16-03). Story 16-03 is left
  with the measurement only.

Story 16-03's benchmark run measures these too, and the design-decisions
entry 15 from story 16-01 lists them.

## Scope

**Out of scope**, because the review refused it:

- GLOSSARY/ADR domain modelling;
- the issue-tracker skills;
- the `ask-matt` router;
- parallel implementer subagents;
- uncapped grilling.

Autonomous runs and the GitHub storage backend are also out of scope (the
maintainer's decision, 2026-11-10).

## Backbone

`Backbone: the plan holds the request → a bug fix starts red → the skills say only what changes behaviour → one benchmark run says whether it worked`

The stories form a plain chain, so there is no tree. s3 rewrites every skill,
including the two that s1 and s2 change, so it runs after both.

## Stories

1. **story-16-01-grilling-rounds-hold-the-request** *(STANDARD)*
2. **story-16-02-a-bug-fix-starts-red** *(QUICK)*
3. **story-16-03-writing-for-agents-pass** *(QUICK; the pass has landed, and
   this story is the one benchmark run)*

## Decisions

- **Rounds, not one question per turn.** A round holds up to 4 questions,
  each with its recommended answer first, so "yes" accepts it. The existing
  budget stays (5–15 questions, 10–20 for auth, migration, billing,
  permissions or data modelling). Pocock's grilling is uncapped; ours is not.
- **An unconfirmed assumption that changes behaviour makes the story
  `not ready`.** When nobody can answer, as in a headless run, the plan
  stops and states the question. It never picks the answer itself.
- **Free measures first, one paid run last.** Line and word counts plus the
  tier 1 and 2 evals run in CI. Then a single benchmark run of the
  coding-flow arm, on the same five tasks, compared with the 2026-10-17
  numbers. N=1, so the result is indicative only (maintainer's decision,
  2026-11-10).
- **The red loop applies in every mode** (maintainer's decision,
  2026-11-10).

## Readiness

`ready`. The four blocking questions were answered on 2026-11-10: the form
of the archive, archive eligibility (both for epic 17), how to measure, and
the modes the red loop covers.
