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

## Acceptance Traceability

All tests drive the CLI against a fake `gh` (`test/fixtures/fake-gh`) first on
PATH; nothing reaches GitHub.

1. Unprotected `main`, 3 check runs → one PUT with exactly those checks, strict
   false, no reviews, enforce_admins false; `--dry-run` sends nothing →
   `test/protect.test.js::protect requires exactly the 3 check runs of main's latest commit, strict false, no reviews`,
   `test/protect.test.js::protect --dry-run sends nothing and prints the plan`
2. Existing reviews + 1 check kept, missing added, second run sends nothing →
   `test/protect.test.js::an existing protection keeps its reviews and check, gains the missing ones, and a second run sends nothing`,
   `test/protect.test.js::a protection with no required checks is rebuilt keeping its reviews and restrictions`
3. No admin / no gh / no check runs → exit 2 with reason and next command; init
   succeeds with the same reason →
   `test/protect.test.js::no admin rights: protect exits 2 …`, `::no gh: …`, `::no check runs: …`
4. init protects default branch and base; `--no-protect` / `protectBranches: false`
   send nothing → `test/protect.test.js::init in a GitHub repository with checks and admin rights protects the default branch and the base`,
   `::init --dry-run prints the protection plan and sends nothing`, `::init --no-protect sends nothing`,
   `::init with protectBranches false sends nothing`
5. ship on a base it cannot protect → no auto-merge, says why; on one it can →
   protects first, then arms → `test/protect.test.js::ship --auto-merge on a base it cannot protect opens the PR without auto-merge and says why`,
   `::ship --auto-merge on a base it can protect protects it first, then arms auto-merge`,
   `::ship --auto-merge on an already protected base arms auto-merge without writing`
6. doctor warns with the command → `test/protect.test.js::doctor warns with the command to run when autoMergeEpic is on and the base has no required checks`,
   `::doctor says nothing when GitHub cannot be read, or auto-merge is off`
7. Real check on this repository → the `protect --dry-run` output under Result.
- Out of scope held: `::a ruleset-governed branch is reported and left alone`,
  `::a non-GitHub remote: protect says GitHub only, init stays quiet`.
- `protectBranches` default documented: `test/rules-registry.test.js::every registry key is in docs/rules-and-limits.md with the same default`.

## Commands

```bash
npm test
```

## Status: in-progress

## Result

Implemented in `bin/lib/protect.js` (new `ai-flow protect`), wired into `init`
(both installs), `ship` (before `gh pr merge --auto`) and `doctor`
(`auto_merge_ungated`); setting `protectBranches` (default `true`) in the rules
registry, `config.js` and `docs/rules-and-limits.md`; README, help, usage,
flow-ship and flow-setup skills, CHANGELOG.

Writes on an existing protection: when it already has required checks, only the
additive endpoint (`POST …/protection/required_status_checks/contexts`) is used,
so nothing else can change; when it has none, a PUT rebuilt from the existing
rule (reviews, restrictions, every flag kept) adds them.

Real check, read-only, on this repository (2026-11-25):

```text
$ ai-flow protect --dry-run --branch main --branch develop
Branch protection (LandryPouth/coding-flow):
  main: nothing to change — already requires test (ubuntu-latest, 18.x), test (ubuntu-latest, 20.x), test (ubuntu-latest, 22.x), test (macos-latest, 22.x), test (windows-latest, 22.x)
  develop: nothing to change — already requires test (ubuntu-latest, 18.x), test (ubuntu-latest, 20.x), test (ubuntu-latest, 22.x), test (macos-latest, 22.x), test (windows-latest, 22.x)
Dry run — nothing to change.
```

Plain `ai-flow protect --dry-run` reports `main` only: this repository sets no
`baseBranch`, so `develop` is protected by `init`/`protect` only when named.
