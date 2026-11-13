# Story 13-07 — A base branch has no fork point

## Status: in-progress

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

- [x] Given a repository whose `develop` (or default branch, or configured
      `baseBranch`) carries a `codingFlowBase`, when `verify` runs from that
      branch, then the recorded fork point is not used as the base, and the
      report names it as ignored (the value and why), instead of a story
      scope.
- [x] Given a story branch with a recorded fork point, then nothing changes
      (the existing fork-point tests stay green, unmodified).
- [x] Given `worktree add <base-branch-name> --from <ref>` on a fresh
      repository where that branch does not exist yet, then no
      `codingFlowBase` is written for it.
- [x] Given a branch whose own diff sets `.coding-flow/config.json`
      `baseBranch` to the current branch (or `--base HEAD`) while it has
      commits of its own, then the diff is not silently emptied: the base is
      read as it was at the fork point (or the run is refused and says why),
      so a strict bar at the base still holds (found by story 13-04's fourth
      review, 2026-11-13).
- [x] `docs/DOGFOODING.md`'s row is resolved (what was done; origin still
      unknown if it is), CHANGELOG `[Unreleased]` → Fixed.

## Out of Scope

- Any other change to how the nearest base is picked.

## Decisions

- **Base branches** are `main`, `master`, `develop`, the default branch and the
  configured `baseBranch` (`baseBranchNames`, `bin/lib/diff-base.js`) — the same
  list `worktree add` checks before recording a fork point.
- **Criterion 4, two answers.** A typed `--base` that is HEAD on a branch with
  commits of its own is **refused**, naming the base to use: a flag the user
  typed is never silently replaced. A `baseBranch` in the tree that empties the
  diff is **read at the base instead**: when the value committed at the
  merge-base with the nearest shared branch differs, that value is used (or the
  nearest base, if it has none), and `diffBase.configIgnored` says why. A
  `baseBranch` the base already carried still applies (the repository chose
  it, not the branch).
- **"Commits of its own"** are counted against the nearest shared branch, not
  the recorded fork point: the fork point is a local setting, and the one on a
  base branch is precisely what this story stops trusting.
- **Base branches are exempt from the refusal**: `--base HEAD` on `develop`
  still verifies only the uncommitted work, as before.
- **Not covered**: a `--base HEAD~N` that skips *some* of a branch's commits
  (and the policy change in them) is still honoured — out of scope ("any
  other change to how the nearest base is picked").
