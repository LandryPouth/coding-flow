# Plan — 16-02 A bug fix starts red, in every mode

## Decisions

- **Its own `##` section, after STRICT.** *A Bug Fix Starts Red* sits between
  the intensity modes and Context Policy, so no mode owns it; QUICK / FAST
  points at it in one line, and Stop Conditions lists the unreproducible bug.
  A step inside each mode would have repeated the loop three times.
- **The red-at-base mechanics move with it, unchanged** (declared
  `redAtBase.command`, node's runner only, `NOT PROVEN` cases): the story moves
  the rule out of STRICT, it does not rewrite `red-at-base`.
- **"See it fail, for the reason the bug report gives."** The added clause
  keeps a loop that is red for an unrelated cause (a missing import) from
  counting as reproduction — the same reason red-at-base calls such a run
  `NOT PROVEN`.
- **The ceiling.** The skill grows from 326 to ~340 lines, well under 500; the
  story's "474 lines" was read before 16-01 trimmed it.
- **The test reads the skill prose**, as `clarify-rounds.test.js` does: the
  evals score routing only, so they cannot hold this text. One eval case was
  added (a crash report routes to `flow-run`).
