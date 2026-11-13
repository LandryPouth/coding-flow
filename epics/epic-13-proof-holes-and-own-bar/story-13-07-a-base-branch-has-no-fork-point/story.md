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
- **A branch contained in its base has nothing of its own**: a fresh story,
  or one already fast-forwarded into its base, gets an empty diff, and that is
  the truth. Only commits HEAD has and its base lacks count.
- **A `baseBranch` is replaced only when it names the current branch itself**
  (same name, a ref resolving to it, or `HEAD`), on a branch that is not a
  base: only the branch's own write can say that. Its base is then its fork
  point, else the value its config held before the commits that hold the
  self-naming value (`valueBefore`: those commits only, never the base's
  history), else the nearest shared branch; `diffBase.configIgnored` gives
  the count since that base. None known: refused; `next` prints the reason
  on stderr and measures from the default base.
- **A typed `--base` that is HEAD** is refused only on a non-base branch with
  commits its real base lacks (the configured `baseBranch`, or the base
  above when that names the branch itself, else the fork point / nearest).
  `--base HEAD` on `develop`, on a configured `trunk` ahead of a stale `main`,
  or on a story with no commits of its own still verifies the uncommitted
  work.
- **Out of scope** (recorded, not fixed):
  - a `baseBranch` naming another ref that points at HEAD (a tag, an alias
    branch) is honoured: it cannot be told apart from a story sitting fresh
    at the top of `develop` without a rule this story does not need;
  - which commits are "the branch's own" is read from git (fork point,
    config history): a branch that rewrites them can still choose its base;
  - a branch outside the story naming (no `story-` prefix, not the
    `--story` folder) that sets `baseBranch` to itself is taken for the base
    branch it declares;
  - a story branch literally named `develop`/`master`/`main` is a base branch
    by name, even in a repository where that branch is not the base;
  - a `--base HEAD~N` that skips *some* of a branch's commits (and the
    policy change in them) is still honoured ("any other change to how the
    nearest base is picked").
