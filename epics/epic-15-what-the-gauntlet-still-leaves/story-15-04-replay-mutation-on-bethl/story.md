# Story 15-04 — Replay the mutation probe on bethl: go or no-go

Wave 5 of the study is conditioned on one experiment: does a diff-scoped
mutation probe find **real** gaps on a project the author did not design?
bethl (`~/dev/saas/bethl`, 144 k lines, 183 s median suite) is the dogfood
project; its suite is too slow to run per mutant, so a targeted test command
is mandatory. Offline, in a throwaway worktree — never in bethl's tree.

*(QUICK — an experiment and a write-up; the probe script is committed as a
repository tool so 15-05 starts from it.)*

## Acceptance Criteria

- [ ] `scripts/mutation-probe.js` (zero-dependency, the study's method):
      sites from a diff's added lines, the operator table, deterministic
      sampling, one throwaway worktree, a targeted command with `{files}`,
      killed/survived/duration printed.
- [ ] Run on three recent bethl stories with high-risk diffs (auth,
      payments or migrations), ≥ 20 mutants each; each survivor classified:
      equivalent, weak assertion, real gap, or not runnable.
- [ ] Recorded in `docs/plans/uncle-bob-gauntlet.md` (wave 5 row): kill
      rate, seconds per mutant, survivors by class, and the verdict.
- [ ] **Go** iff at least one survivor is a real gap or a weak assertion on
      a high-risk path; otherwise **no-go**, and 15-05 is closed as "not
      built, see 15-04".
- [ ] bethl's working tree and branches are unchanged (checked by `git
      status` and `git worktree list` before and after).

## Result
