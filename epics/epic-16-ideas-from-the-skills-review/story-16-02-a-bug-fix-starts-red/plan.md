# Plan — 16-02 A bug fix starts red, in every mode

## Decisions

- **Its own `##` section, after STRICT.** *A Bug Fix Starts Red* sits between
  the intensity modes and Context Policy, so no mode owns it; QUICK / FAST
  points at it in one line, and Stop Conditions lists the unreproducible bug.
  A step inside each mode would have repeated the loop three times.
- **The red-at-base mechanics move with it, STRICT's bar kept.** The base-side
  failure examples, the non-Node sentence (Jest/Vitest/Go/pytest proven by the
  ordinary verify and negative evidence) and "under STRICT, a Node project
  declares `redAtBase.command` first" move with the rule (review P2-1: the first
  move had dropped them).
- **A copy or typo change is not a bug fix** (review P2-2), so a pure copy edit
  needs no red loop; QUICK step 3 names the quoted red output as the exception.
- **An unreproducible bug sets `## Status: blocked`** with "not reproduced" in
  `## Result` (review P2-4).
- **Review P2-5 accepted as a limit:** the test pins exact phrases; 16-03 will
  have to update it when it rewords the skill.
- **"See it fail, for the reason the bug report gives."** The added clause
  keeps a loop that is red for an unrelated cause (a missing import) from
  counting as reproduction — the same reason red-at-base calls such a run
  `NOT PROVEN`.
- **The ceiling.** The skill grows from 326 to ~340 lines, well under 500; the
  story's "474 lines" was read before 16-01 trimmed it.
- **The test reads the skill prose**, as `clarify-rounds.test.js` does: the
  evals score routing only, so they cannot hold this text. One eval case was
  added (a crash report routes to `flow-run`).
