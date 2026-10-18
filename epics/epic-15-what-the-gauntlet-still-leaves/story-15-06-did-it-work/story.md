# Story 15-06 — Did it work? Re-take the study's measures

The study ends with five measures "readable from `.coding-flow/runs/`".
Nothing re-takes them once the work lands; without this story, the study's
success is asserted, which is the failure the tool exists to reject.

*(QUICK — measurement and a write-up. Runs after every other story of epics
13–15 has landed.)*

## Acceptance Criteria

- [ ] The run analysis (study, *Reproducing the measurements*) re-run on the
      runs recorded **since epic 13 started**: review passes per STRICT
      story (was 10–12, target ≤ 3); share of verifies at `verified` (was
      0 %); share of P1s caught by `verify` rather than review; surviving
      mutants per story (if 15-05 was built); new worktree rows in
      `docs/DOGFOODING.md`.
- [ ] A dated *Re-measured* section in `docs/plans/uncle-bob-gauntlet.md`
      with the numbers, whatever they say, and which targets were missed.
- [ ] The study's open question (make the worktree layer optional) gets an
      answer from the worktree-row count, recorded in
      `docs/design-decisions.md` if it is decided.
- [ ] The analysis script is committed under `scripts/` so the next
      re-measure is one command.

## Result
