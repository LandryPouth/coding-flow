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

- **Base branches** are `main`, `master`, `develop` and the default branch by
  name, plus the configured `baseBranch` unless it names a story branch
  (`story-*`, or the `--story` folder's name): a story that sets `baseBranch`
  to itself is not a base (`isBaseBranch`, `bin/lib/diff-base.js`).
  `worktree add` records no fork point for those names.
- **A fork point is ignored** (and named in `diffBase.forkPointIgnored`) on a
  base branch, and when it names the branch itself.
- **A base that is HEAD** (flag or `baseBranch`) is a choice on a base branch:
  `--base HEAD` on `develop`, or on a configured `trunk` ahead of a stale
  `main`, still verifies only the uncommitted work. On any other branch it
  empties the diff when the branch has commits of its own, counted from the
  first of: a `baseBranch` value the branch's history carried earlier (walking
  the commits that touch `.coding-flow/config.json`, newest first), its fork
  point, the nearest shared branch (`ownCommitsStart`). Then:
  - a typed `--base` is **refused**, naming that base — a flag the user typed
    is never silently replaced;
  - a `baseBranch` gives way to that base, and `diffBase.configIgnored` says
    why;
  - a `baseBranch` naming the branch itself with none of those known is
    **refused** (nothing to measure from). `next` catches it and falls back
    to the default base.
- **Out of scope** (recorded, not fixed):
  - a branch outside the story naming (no `story-` prefix, not the
    `--story` folder) that sets `baseBranch` to itself is taken for the base
    branch it declares;
  - a story branch literally named `develop`/`master`/`main` is a base branch
    by name, even in a repository where that branch is not the base;
  - a `--base HEAD~N` that skips *some* of a branch's commits (and the
    policy change in them) is still honoured ("any other change to how the
    nearest base is picked").
