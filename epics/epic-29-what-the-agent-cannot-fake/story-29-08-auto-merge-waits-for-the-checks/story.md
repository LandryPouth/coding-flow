# Story 29-08 — Auto-merge waits for the checks

## Why

`ship` arms GitHub's native auto-merge (`gh pr merge --auto`) and says the
required checks still gate the merge. That holds only if the base branch is
protected with required checks. On an unprotected base, GitHub merges at once,
CI or not: it happened on this repository (memory: "auto-merge merges at
once"). With every story going out as its own auto-merged PR (maintainer,
2026-11-25), the tool must make that gate real in the project it is installed
in, not assume it. The maintainer asked on 2026-11-25: "L'outil doit activer la
protection auto du projet dans lequel il est installé".

## Design

- **`ai-flow protect [--branch <name>]… [--dry-run] [--json]`** protects the
  default branch and the configured base (both when they differ) on GitHub
  through `gh api`:
  - required status checks = the check runs seen on the branch's latest
    commit (names read from GitHub, never guessed), `strict: false`;
  - `enforce_admins: false`, no required reviews, no force pushes, no
    deletion.
  - **It never weakens an existing protection.** An existing rule keeps its
    reviews, restrictions and checks; missing required checks are added, never
    removed. Running it twice changes nothing.
  - It needs `gh` and admin rights on the repository. Without them it says what
    is missing and what to run, and exits 2. It never fails `init`.
  - When the branch has no check runs yet (no CI), it does not protect it with
    an empty check list. It says the project needs CI first.
- **`init` protects automatically** when the project is a GitHub repository,
  `gh` is authenticated with admin rights, and CI checks exist: it prints what
  it protected. `init --no-protect` and the setting `protectBranches: false`
  skip it. `init --dry-run` prints the plan only.
- **`ship` never arms auto-merge on an unprotected base.** Before `--auto`, it
  checks that the base has required status checks. If not, it runs `protect`
  for the base when it can (same conditions). Otherwise it opens the PR without
  auto-merge and says why ("GitHub would merge at once").
- **`doctor`** warns when auto-merge is enabled (`autoMergeEpic`) and the base
  has no required checks. It reads GitHub only when `gh` is available, and a
  network failure says nothing.

## Acceptance Criteria

- [ ] Given a stubbed `gh` reporting an unprotected `main` whose latest commit
      has 3 check runs, when `ai-flow protect` runs, then it sends one
      protection request requiring exactly those 3 checks, `strict: false`, no
      reviews, `enforce_admins: false`. Given `--dry-run`, it sends nothing and
      prints the plan.
- [ ] Given an existing protection with required reviews and 1 required check,
      then `protect` keeps the reviews and the check, adds the missing ones, and
      a second run sends nothing.
- [ ] Given no admin rights, no `gh`, or no check runs, then `protect` exits 2
      with the reason and the next command, and `init` still succeeds and prints
      the same reason.
- [ ] Given `init` in a GitHub repository with checks and admin rights, then the
      default branch and the base are protected. Given `--no-protect` or
      `protectBranches: false`, then nothing is sent.
- [ ] Given `ship --auto-merge` on an unprotected base it cannot protect, then
      the PR opens without auto-merge, and the output says why. Given a base it
      can protect, then it protects the base first and arms auto-merge.
- [ ] Given `autoMergeEpic: true` and an unprotected base, then `doctor` warns
      with the command to run.
- [ ] Real check: on this repository (`main` and `develop` were protected by
      hand on 2026-11-25), `ai-flow protect --dry-run` reports nothing to
      change.

## Out of Scope

- GitLab and other forges (say "GitHub only" when the remote is not GitHub).
- Repository rulesets. Classic branch protection only; a branch already
  governed by a ruleset is reported and left alone.

## Commands

```bash
npm test
```

## Status: in-progress

## Result
