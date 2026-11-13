# Story 13-07 — A base branch has no fork point

## Status: planned

`develop` carried `branch.develop.codingFlowBase = 4c7280c` (a SHA, recorded
after story 13-04's own commit). `resolveDiffBase` (`bin/lib/diff-base.js`)
trusted it, so every verify run from `develop` measured "all of `develop`
since 4c7280c": 13-04 and 15-01 could not be proven there, and inherited reds
from unrelated files (`docs/DOGFOODING.md`, 2026-11-10, "verify (proof
scope)", `high`). The only writer, `worktree add` (`bin/lib/worktree.js`
~272), writes on a *new* branch only, and `develop`'s reflog is continuous
since its creation: what wrote the value is not established. The value was
removed by hand on 2026-11-13 (`git config --unset`).

*(QUICK — bug fix in the base resolution, behavioural tests on throwaway
repositories.)*

## Acceptance Criteria

- [ ] Given a repository whose `develop` (or default branch, or configured
      `baseBranch`) carries a `codingFlowBase`, when `verify` runs from that
      branch, then the recorded fork point is not used as the base, and the
      report names it as ignored (the value and why), instead of a story
      scope.
- [ ] Given a story branch with a recorded fork point, then nothing changes
      (the existing fork-point tests stay green, unmodified).
- [ ] Given `worktree add <base-branch-name> --from <ref>` on a fresh
      repository where that branch does not exist yet, then no
      `codingFlowBase` is written for it.
- [ ] `docs/DOGFOODING.md`'s row is resolved (what was done; origin still
      unknown if it is), CHANGELOG `[Unreleased]` → Fixed.

## Out of Scope

- Any other change to how the nearest base is picked.
