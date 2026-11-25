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
    commit **that are also seen on every recent pull-request commit that had
    checks**: the head commits of the most recent pull requests into that branch
    (`gh pr list --base <branch> --state all -L 5 --json headRefOid`, then
    `commits/<sha>/check-runs`), intersected. Names are read from GitHub, never
    guessed; `strict: false`. A check that runs only on push (deploy, release,
    pages) never reports on a pull request, and one that runs only on some
    (`paths:` filter, fork pull requests only) is missing from the others:
    requiring either would leave a PR pending forever, so they are listed as
    "not required (never seen on a pull request)" / "not required (not on every
    pull request)" and left out. When checks would be added and one of those
    pull requests ran no checks at all (a `paths:` filter on the whole CI), nothing is sent, exit 2: an
    unprotected branch says "a recent pull request ran no checks (a `paths:`
    filter?) — requiring checks would block such pull requests forever" (review
    round 3); a branch already protected is left as is, nothing sent: "left as is (requires …) — a recent pull request ran no checks; requiring more would block such pull requests" (review round 4; with no required check: "left as is (no required check; its other rules kept) — …"). GitHub refusing the checks added to an existing protection: "left as is — GitHub refused adding required check(s) …" (series 2 round 1);
  - `enforce_admins: false`, no required reviews, no force pushes, no
    deletion.
  - **It never weakens an existing protection.** An existing rule keeps its
    reviews, restrictions and checks; missing required checks are added, never
    removed. Running it twice changes nothing.
  - It needs `gh` and admin rights on the repository. Without them it says what
    is missing and what to run, and exits 2. It never fails `init`.
  - When the branch has no check runs yet (no CI), it does not protect it with
    an empty check list. It says the project needs CI first.
  - With no pull request into the branch yet, the pull-request checks are
    unknown: it does not protect, says "open one pull request first, so the
    checks that run on pull requests are known", and exits 2 (`init` prints it
    and succeeds). A branch whose checks are already all required is left
    unchanged without that lookup.
  - **Plan limit.** A private repository on GitHub Free has no branch
    protection (GitHub answers 403 "Upgrade to GitHub Pro or make this
    repository public"). `protect`, `init`, `ship` and `doctor` say "branch
    protection is not available on this plan (private repository on GitHub
    Free)" and give the real next step (merge each pull request by hand once its
    checks pass, or make the repository public / move to a paid plan) — never
    `gh auth status`. A dry run that blocked anything never says "nothing to
    change".
  - **Rulesets.** A branch governed by a ruleset is left alone. When the
    ruleset has no required status checks rule, auto-merge would merge at once:
    `protect` reports it as pending (exit 2, never "nothing to change"), and
    `protect`, `ship` and `doctor` say "add a required status checks rule to the
    ruleset protecting <branch>" (series 2 round 1).
  - **Limits.** Legacy commit statuses are not read (such a project is told it
    needs CI first); a required check that no longer runs is never flagged or
    removed (additive only); `doctor` checks only the default branch and
    `baseBranch`, so a `ship --base` elsewhere is protected by `ship` but never
    checked by `doctor` (review round 4); a `baseBranch` missing on GitHub is
    warned (`auto_merge_base_missing`, series 2 round 3). All stated in
    `docs/rules-and-limits.md`.
- **`init` protects automatically** when the project is a GitHub repository,
  `gh` is authenticated with admin rights, and CI checks exist: it prints what
  it protected. `init --no-protect` and the setting `protectBranches: false`
  skip it. `init --dry-run` prints the plan only.
- **`ship` never arms auto-merge on an unprotected base.** Before `--auto`, it
  reads the repository's `allow_auto_merge` (off → nothing written, says so),
  then checks that the base has required status checks. If not, it runs `protect`
  for the base when it can (same conditions). Otherwise it opens the PR without
  auto-merge and says why ("GitHub would merge at once"). A base whose
  protection cannot be read is not called unprotected: "could not read
  "<base>"'s protection (…), so auto-merge is not armed"; nor is a repository
  `gh` cannot read: "`gh` cannot read this repository (…), so "<base>"'s
  protection could not be checked" (series 2 round 3). `ship --dry-run` says
  the real run may first write a branch protection only when it would.
- **`protect` writes only to a branch it was given**: `--branch` with no name
  and a bare name (`protect develop`) are refused, exit 1 (series 2 round 3).
- **`doctor`** warns when auto-merge is enabled (`autoMergeEpic`) and the base
  has no required checks (`auto_merge_ungated`; a ruleset without a required
  status checks rule names the rule to add), the plan has no branch
  protection (`auto_merge_plan_limit`), the repository has "Allow auto-merge"
  off (`auto_merge_disabled`), or the base's protection cannot be read
  (`auto_merge_unread`). It reads GitHub only when `gh` is available, and a
  repository it cannot read at all says nothing.

## Review findings

### Round 1 — FAIL (safety of a tool that writes someone's GitHub settings)

- [x] P1 bin/lib/protect.js:156-165, :233 — every check run on the branch's latest commit becomes required, including checks that only run on push (deploy, release, pages, CodeQL-on-push, a Vercel production deploy). Such a check never reports on a PR, so every PR stays pending forever and auto-merge never fires — and `init` does it by default. — fix: require only names also seen on a pull-request commit (e.g. the head commit of the last merged PR, or Actions runs whose `event` is `pull_request`); with no PR evidence, don't protect and say "open one PR first". Fake-gh test: a push-only `deploy` check on `main` is not required.
- Minor (not blocking): `required_signatures` not carried by the full PUT (believed untouched by it); a failed ruleset read is read as "no rulesets" (still additive only); no test for a protection read that errors in `ship` (code handles it).

Held: additive POST when checks exist; full PUT only with no checks, every returned field translated; rulesets left alone; `init` prints each write and honours `--dry-run`/`--no-protect`/`protectBranches:false`; `upgrade` never protects; `ship` never arms on any read/PUT failure; 18/18 with request bodies asserted.

### Round 2 — FAIL (real-world repositories and their failure answers)

- [x] P1 protect.js:179-186, :273 — the union of checks over the last 5 PRs is required: a check that runs only on some paths (`paths:` filter) or only on fork PRs gets required after one PR ran it, then blocks every PR that doesn't run it (fake-gh repro: PRs show [test], [test], [api-tests] → requires api-tests, test) — fix: require only checks seen on EVERY recent PR that had checks (intersection); list the rest as "not required (not on every pull request)"; fake-gh test.
- [x] P1 protect.js:240, :409, ship.js:654 — a plan limit (bethl: private repo on GitHub Free, 403 "Upgrade to GitHub Pro or make this repository public") is reported as an auth problem ("Next: check `gh auth status`", "has no required status checks … Next: run `ai-flow protect`") and the dry run still prints "nothing to change" — fix: on that 403 say "branch protection is not available on this plan (private repository on GitHub Free)" and give a real next step (merge on green by hand, or 29-09's watch-and-merge); never print "nothing to change" when something was blocked.
- [x] P2 doctor `checkAutoMergeGate` / protect.js:431 stays silent on the plan limit — warn.
- [x] P2 ship.js:649 may write the protection before `gh pr merge --auto` even when the repository has auto-merge disabled (`allow_auto_merge: false`) — check it first and say so.
- [x] P2 legacy commit statuses are not read ("needs CI first" for such repos); required checks that no longer run are never flagged — state both as limits.

Held: coding-flow dry run clean (exit 0, nothing sent); bethl exit 2, nothing written; `ship` never arms on a failed read/PUT; push-only checks excluded; no-PR and no-checks cases blocked clearly; mutation of the round-1 fix fails 3/23.

### Round 3 — FAIL (criteria held and proved, by mutation)

- [x] P1 bin/lib/ship.js:649 — nothing proves `ship` honours `protectBranches: false` (hardcoding true survives 30/30) — fix: fake-gh test, `ship --auto-merge` with `protectBranches:false` on an unprotected base: 0 `-X` writes, auto-merge not armed, reason printed.
- [x] P1 test/protect.test.js:174 (criterion 2, never weakens) — mutants of `keepAndAddChecks` survive (code-owner reviews → false; approving count always 1); `require_last_push_approval`, `dismiss_stale_reviews`, bypass allowances, `block_creations`, `required_conversation_resolution`, `lock_branch` unchecked — fix: fixture with every field non-default, assert each carries through.
- [x] P1 README.md:352, docs/rules-and-limits.md:35, CHANGELOG.md:11 — claim a `paths:`-filtered check "is never required", but protect.js:196 skips PRs with no checks at all, so a repo whose only CI has `paths:` gets [build,test] required and docs-only PRs pend forever (fake-gh: PRs [build,test] and [] → requires build, test) — fix (orchestrator's choice: the safe side): when any of the recent PRs ran no checks, protect nothing for that branch, exit 2, say "a recent pull request ran no checks (a `paths:` filter?) — requiring checks would block such pull requests forever"; docs say exactly that.
- [x] P2 doctor "says nothing when GitHub cannot be read" half proved (dropping `!info.error` in `ungatedBases` survives) — add the test.

Held: round-1 push-only fixture not weakened; init consent and dry run hold (0 `-X`); messages match docs; criteria 1, 3, 4, 6, 7 may be ticked (real dry run: main nothing to change, exit 0).

### Round 4 — FAIL (readiness to land, whole journey) — one message; series 1 ends at its cap, series 2 starts

- [x] P1 bin/lib/protect.js:302-305 with :409 — a branch already protected (requires `build`, not all checks) with a recent no-checks PR prints "main: not protected — … would block such pull requests forever": false, it is protected; effect correct (nothing sent, nothing weakened, ship arms, doctor quiet), message lies; docs "nothing is protected on that branch" hide it — fix: when `info.protection` exists say "main: left as is (requires build) — a recent pull request ran no checks; requiring more would block such pull requests"; docs say "left as is"; test asserts text and nothing sent.
- [x] P2 `ship --dry-run --auto-merge` (~ship.js:740) never says the real run may write a branch protection first — say it.
- [x] P2 `protect`/doctor target only the default branch plus `baseBranch`; `ship --base develop` without `baseBranch` leaves develop unchecked by doctor — state as a limit (or include the `--base` used).

Held: merge with develop clean, 142/142 + windows-paths 19/19 + layering 4/4, plugin check in sync; fake-gh journey truthful and idempotent; fixture edits kept assertions, moved cases have their own tests; real dry runs correct (coding-flow nothing to change; bethl plan limit, exit 2).

### Series 2 Round 1 — FAIL (every message a newcomer reads)

- [x] P1 bin/lib/protect.js:385 + :418 — existing protection (reviews only) + GitHub refuses the PUT → "main: not protected — GitHub refused the protection": false — fix: when `info.protection` exists, "left as is — GitHub refused adding required check(s) …".
- [x] P1 bin/lib/protect.js:477 → ship.js:654 — protection read fails (HTTP 500) → ship says "\"main\" has no required status checks, so GitHub would merge at once (could not read …)": it cannot know — fix: for error/missing, `why` = "could not read \"main\"'s protection (…), so auto-merge is not armed".
- [x] P1 doctor.js:223 + protect.js:287 — ruleset branch without a required-checks rule: doctor says run `ai-flow protect --branch main`; protect says "left alone", exit 0, dry run "nothing to change" while auto-merge would merge at once — dead end (ship: no Next) — fix: doctor, protect and ship say "add a required status checks rule to the ruleset protecting <branch>"; protect reports it as pending (exit 2), never "nothing to change".
- [x] P2 "left as is (requires no check) … requiring more" / "kept no check and every other rule" read oddly when nothing is required — word for the empty case.
- [x] P2 `ship --dry-run` "may first write a branch protection" also prints on an already gated, ruleset, or plan-limited base — print it only when the real run would write.
- [x] P2 doctor silent on HTTP 500; on `allow_auto_merge: false` it says only "run protect" — name the real blocker (enable auto-merge in the repository settings).

Held: refactor changed no behaviour (only the two intended lines differ vs c2c0c82); plan limit, no PRs, push-only, no-checks PR, partial/full protection, auto-merge disabled, no admin, no CI: true, named, actionable; `--dry-run` 0 writes everywhere.

### Series 2 Round 2 — FAIL (changed tests and new states, by mutation) — tests only

- [x] P1 bin/lib/protect.js:369 — `&& result.action === "add-checks"` untested (`leftAsIs = !result.planLimit` survives 42/42; would print "left as is" on an unprotected refused branch) — fix: test `unprotected({ refuseWrites: true })` asserting "not protected — GitHub refused the protection" and doesNotMatch /left as is/.
- [x] P1 bin/lib/protect.js:517 (ship.js:679) — `wouldProtect: true` survives; the dry-run test only uses states that stop before runProtect — fix: unprotected base with `checkRuns: []` (no CI → no write): `ship --dry-run` must not print `protect : `.
- [x] P2 protect.js:494 redundant line — use `why: \`"${base}"'s protection could not be read (${cause})\`` → "Auto-merge: not armed — \"main\"'s protection could not be read (…). Next: …".
- [x] P2 `manual: true` (protect.js:485/489/520) untested — assert doesNotMatch(/Merge the PR once/) in the disabled and plan-limit ship tests.
- [x] P2 test/protect.test.js:797 stale comment "so it says nothing".
- [x] P2 missing-branch `push "<base>"` next step untested — add an assertion.

Held: changed tests keep/strengthen every assertion, nothing dropped; 11/17 mutants killed (the rest above); merge with develop clean, 169/169, plugin check in sync.

### Series 2 Round 3 — FAIL (the docs a user reads, against the code)

- [x] P1 bin/lib/protect.js:506 (ship.js:654) — `gh repo view` fails (HTTP 502) → ship prints "\"main\" has no required status checks, so GitHub would merge at once (…)" and "Next: run `gh auth login`", contradicting CHANGELOG.md:11 and README — fix: when `repoInfo.blocked`, `why: "<repo> could not be read (…)"`, no auth next step for a 5xx; fake-gh test asserting doesNotMatch /no required status checks/.
- [x] P1 (orchestrator, raised from P2: a write to a branch the user did not name) — `protect --branch` with no value and `protect develop` (bare name) silently target the default branch, and without `--dry-run` write to main — fix: refuse both with exit 1 and one line (`--branch needs a name`; `unexpected argument "develop" — did you mean --branch develop?`); tests.
- [x] P2 merge with develop conflicts (CHANGELOG.md, ship.js `todo` require from 26-07) — merge develop into the story branch keeping both sides.
- [x] P2 CHANGELOG says a non-GitHub remote prints "the next command"; no `Next:` is printed — align.
- [x] P2 docs "a recent PR ran no checks → exit 2": a branch already requiring every check exits 0 without reading PRs — say "when checks would be added".
- [x] P2 rules-and-limits `protectBranches` row says init and ship protect default + baseBranch; ship protects only the base it ships to; the limits row contradicts itself — fix the row.
- [x] P2 doctor silent when `baseBranch` is missing on GitHub — state as a limit (or warn).
- [x] P2 `ship --help` doesn't say `--auto-merge` may write a branch protection — add it.

Held: protect/init/ship help; `--branch=x`; protectBranches:false message; `ship --base develop` protects before arming; init on a non-GitHub remote silent; merged tree (both sides kept) 156/156, plugin check in sync.
Series 2 round 4 is the last of the series.

### Series 2 Round 4 — PASS (sign-off as a whole) — series closes at its cap; lands

- [x] P2 traceability for criterion 6 named a test that does not exist and missed the base-missing ship test — fixed by the orchestrator.

Held: protect 47/47; C1–C6 each backed by its test and a fake-gh probe; every argument form that could target an unnamed branch refused (exit 1, no write); 502 path true in ship/protect/init, 401 still to `gh auth login`; `auto_merge_base_missing`; merge 5a3c04f intact (ship-before-deploy 4/4, human-todo 30/30); real dry runs correct (coding-flow nothing to change; bethl plan limit, exit 2).
Decision: two series (4 + 4 rounds); the last round clean on the whole story after the series-3 fixes, findings had narrowed to messages and traceability. Lands.

## Acceptance Criteria

- [x] Given a stubbed `gh` reporting an unprotected `main` whose latest commit
      has 3 check runs, when `ai-flow protect` runs, then it sends one
      protection request requiring exactly those 3 checks, `strict: false`, no
      reviews, `enforce_admins: false`. Given `--dry-run`, it sends nothing and
      prints the plan.
- [x] Given an existing protection with required reviews and 1 required check,
      then `protect` keeps the reviews and the check, adds the missing ones, and
      a second run sends nothing.
- [x] Given no admin rights, no `gh`, or no check runs, then `protect` exits 2
      with the reason and the next command, and `init` still succeeds and prints
      the same reason.
- [x] Given `init` in a GitHub repository with checks and admin rights, then the
      default branch and the base are protected. Given `--no-protect` or
      `protectBranches: false`, then nothing is sent.
- [x] Given `ship --auto-merge` on an unprotected base it cannot protect, then
      the PR opens without auto-merge, and the output says why. Given a base it
      can protect, then it protects the base first and arms auto-merge.
- [x] Given `autoMergeEpic: true` and an unprotected base, then `doctor` warns
      with the command to run.
- [x] Real check: on this repository (`main` and `develop` were protected by
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
   `test/protect.test.js::protect --dry-run sends nothing and prints the plan`;
   only checks seen on a pull request (review round 1, P1) →
   `::a push-only check on the branch is not required; the checks seen on a pull request are`,
   `::only push checks on the branch: protect exits 2 and sends nothing`,
   `::an existing protection gains only the checks seen on a pull request`;
   only checks seen on every recent pull request (review round 2, P1) →
   `::a check seen on only some recent pull requests is not required; one seen on every pull request is`,
   `::no check ran on every recent pull request: protect exits 2 and sends nothing`;
   a recent pull request with no checks (review round 3, P1) →
   `::a recent pull request that ran no checks: protect protects nothing, exits 2, and says why`,
   `::an already protected branch with a recent pull request that ran no checks is left as is, and says so` (review round 4)
2. Existing reviews + 1 check kept, missing added, second run sends nothing →
   `test/protect.test.js::an existing protection keeps its reviews and check, gains the missing ones, and a second run sends nothing`,
   `test/protect.test.js::a protection with no required checks is rebuilt keeping its reviews and restrictions`,
   `::a protection with no required checks keeps every rule, each non-default, when the checks are added` (review round 3)
3. No admin / no gh / no check runs → exit 2 with reason and next command; init
   succeeds with the same reason →
   `test/protect.test.js::no admin rights: protect exits 2 …`, `::no gh: …`, `::no check runs: …`,
   `::no pull request yet: …`
4. init protects default branch and base; `--no-protect` / `protectBranches: false`
   send nothing → `test/protect.test.js::init in a GitHub repository with checks and admin rights protects the default branch and the base`,
   `::init --dry-run prints the protection plan and sends nothing`, `::init --no-protect sends nothing`,
   `::init with protectBranches false sends nothing`
5. ship on a base it cannot protect → no auto-merge, says why; on one it can →
   protects first, then arms → `test/protect.test.js::ship --auto-merge on a base it cannot protect opens the PR without auto-merge and says why`,
   `::ship --auto-merge on a base it can protect protects it first, then arms auto-merge`,
   `::ship --auto-merge on an already protected base arms auto-merge without writing`,
   `::ship --auto-merge when the base's protection cannot be read does not arm auto-merge`;
   plan limit and auto-merge off (review round 2) →
   `::a plan without branch protection: protect says so, gives a real next step, never 'nothing to change'`,
   `::a dry run with a blocked branch never prints 'nothing to change'`,
   `::ship --auto-merge on a plan without branch protection says so and does not arm auto-merge`,
   `::ship --auto-merge on a repository with auto-merge disabled writes nothing and says so`;
   `protectBranches: false` in ship (review round 3) →
   `::ship --auto-merge with protectBranches false on an unprotected base writes nothing and does not arm auto-merge`;
   dry run names the protection write (review round 4) →
   `::ship --dry-run --auto-merge says the real run may write a branch protection first, and sends nothing`;
   a repository gh cannot read (series 2 round 3) →
   `::ship --auto-merge when GitHub cannot read the repository does not call the base unprotected`;
   only a named branch is written (series 2 round 3) →
   `::protect refuses --branch with no name and a bare branch name, and sends nothing`
6. doctor warns with the command → `test/protect.test.js::doctor warns with the command to run when autoMergeEpic is on and the base has no required checks`,
   `::doctor says nothing when GitHub cannot be read, or auto-merge is off`,
   `::doctor warns on a plan without branch protection`,
   `::doctor does not call a base whose protection cannot be read ungated, and says it could not read it` (review round 3), `::ship --auto-merge on a base missing on GitHub does not arm auto-merge and says to push it` (series 2 round 3),
   `::doctor warns when baseBranch does not exist on GitHub` (series 2 round 3)
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

Verify (one run, on `4ef7b22`): FAILED on one test,
`test/layering.test.js::every module under bin/lib is classified as core or layer`
(the new `protect` module was unclassified; evidence
`.coding-flow/runs/2026-11-25T17-35-51-541Z-verify.json`). Fixed in the next
commit (`protect` listed as a layer module; the layering test passes alone). The
other ✖ in that run is the existing `todo` test in `weakened-tests.test.js`, not a
failure. The fixed tree still needs its verify.

Round 1 fix (P1): a check is required only when it is also seen on a
pull-request commit. `planBranch` reads the head commits of the last 5 pull
requests into the branch (`gh pr list --base <branch> --state all -L 5 --json
headRefOid`) and their check runs, and intersects them with the branch's own;
the rest is printed as "not required (never seen on a pull request)". No pull
request yet → exit 2, "open one pull request first, so the checks that run on
pull requests are known", nothing sent (`init` prints it and succeeds). The fake
gh answers `pr list` from `state.pulls`; the tests above fail on the round-1
code (4 of them) and pass now. Also tested: a protection read that errors makes
`ship` leave auto-merge off.

Real check after the fix, read-only (2026-11-25):

```text
$ ai-flow protect --dry-run --branch main --branch develop
Branch protection (LandryPouth/coding-flow):
  main: nothing to change — already requires test (ubuntu-latest, 18.x), test (ubuntu-latest, 20.x), test (ubuntu-latest, 22.x), test (macos-latest, 22.x), test (windows-latest, 22.x)
  develop: nothing to change — already requires test (ubuntu-latest, 18.x), test (ubuntu-latest, 20.x), test (ubuntu-latest, 22.x), test (macos-latest, 22.x), test (windows-latest, 22.x)
Dry run — nothing to change.
```

Verify (one run, on `dd6e354`): NOT PROVEN — all 3 commands passed, but
`functionSize.enforce` flagged `bin/lib/doctor.js` `collectDoctorReport` 221→222
lines (the round-1 `checkAutoMergeGate` call; evidence
`.coding-flow/runs/2026-11-25T18-19-39-965Z-verify.json`). Fixed in the next
commit: the call moved into `checkEvidenceAndRecovery`, which both doctor reports
already run, so neither grows (protect and doctor tests pass alone). The fixed
tree still needs its verify.

Round 2 fixes (fresh implementer):

- P1 intersection: `pullRequestCheckNames` keeps only the checks seen on every
  recent pull request that had checks; the rest are printed "not required (not
  on every pull request)". With none common (the reviewer's repro [test],
  [test], [api-tests]) nothing is sent, exit 2. The round-1 test "a push-only
  check on the branch is not required…" split the three checks across two PRs,
  which the intersection rightly refuses: its fixture now has both PRs report
  the three checks (its assertions are unchanged).
- P1 plan limit: the 403 "Upgrade to GitHub Pro…" on the protection read or
  write is `planLimit` — one line "branch protection is not available on this
  plan (private repository on GitHub Free)", next step "merge each pull request
  by hand once its checks pass …, or make the repository public or move it to a
  paid plan". Same in `init` (through `protect`), `ship` (no "has no required
  status checks", no `gh auth status`) and `doctor`. A dry run with a blocked
  branch prints "Dry run — nothing sent.", never "nothing to change". Story
  29-09's watch-and-merge is not built yet, so it is not offered as a command.
- P2: `doctor` warns `auto_merge_plan_limit`; `ship` reads `allow_auto_merge`
  before writing protection and, when it is off, writes nothing and says so;
  legacy commit statuses and stale required checks are stated as limits in
  `docs/rules-and-limits.md`.
- The 7 new fake-gh tests fail on the round-2 code (`bin/lib` stashed: 7/30
  fail) and pass now (30/30).

Real checks after the fix, read-only (2026-11-25):

```text
$ ai-flow protect --dry-run --branch main --branch develop    # coding-flow
Branch protection (LandryPouth/coding-flow):
  main: nothing to change — already requires test (ubuntu-latest, 18.x), test (ubuntu-latest, 20.x), test (ubuntu-latest, 22.x), test (macos-latest, 22.x), test (windows-latest, 22.x)
  develop: nothing to change — already requires test (ubuntu-latest, 18.x), test (ubuntu-latest, 20.x), test (ubuntu-latest, 22.x), test (macos-latest, 22.x), test (windows-latest, 22.x)
Dry run — nothing to change.
(exit 0)

$ ai-flow protect --dry-run                                     # bethl
Branch protection (LandryPouth/BeThl):
  develop: not protected — branch protection is not available on this plan (private repository on GitHub Free)
Dry run — nothing sent.
Next: merge each pull request by hand once its checks pass (auto-merge cannot wait for them here), or make the repository public or move it to a paid plan, then run `ai-flow protect`
(exit 2)
```

Round 3 fixes (fresh implementer):

- P1 `paths:`: `pullRequestCheckNames` counts the recent pull requests that ran
  no check at all; when there is one, `planBranch` protects nothing on that
  branch and exits 2: "a recent pull request ran no checks (a `paths:` filter?)
  — requiring checks would block such pull requests forever". README,
  `docs/rules-and-limits.md` and CHANGELOG say exactly that. The round-2 test
  "a check seen on only some recent pull requests…" had a fourth PR with no
  checks, which the safe side now rightly refuses: that PR is dropped from its
  fixture (its assertions are unchanged).
- P1 `ship` + `protectBranches: false`: fake-gh test, 0 writes, not armed,
  reason printed.
- P1 never weakens: a fake-gh test whose protection sets every rule to its
  non-default value asserts the whole PUT body.
- P2 doctor: a test where the repository reads but the base's protection
  answers HTTP 500 — no warning.
- Mutants, each in a copy: `protectBranches` hardcoded true in `ship`;
  code-owner reviews → false; approving count → 1; last-push approval → false;
  `lock_branch` → false; the no-checks block disabled (exit 0, protected);
  `!info.error` dropped in `ungatedBases` — each fails its new test; 34/34 pass
  on the real code.

Round 4 fixes (fresh implementer):

- P1: a branch that already has a protection, with a recent pull request that
  ran no checks, now prints "main: left as is (requires build) — a recent pull
  request ran no checks; requiring more would block such pull requests" (still
  exit 2, nothing sent); README, `docs/rules-and-limits.md`, CHANGELOG and
  Design say "left as is". Fake-gh test asserts the text and zero `-X` calls.
- P2: `ship --dry-run --auto-merge` prints "protect : the real run may first
  write a branch protection on "<base>" (when it has no required checks)"
  (fake-gh test, nothing sent); the `--base` without `baseBranch` gap is a
  limit in `docs/rules-and-limits.md`.
- Both new tests failed on `c2c0c82` (0/2) and pass now (36/36).

Verify (one run, round 4 tree before the refactor): NOT PROVEN — all 3 commands
passed, but `functionSize.enforce` flagged `protect.js` `planBranch` 0→88 and
`ship.js` `ship` 168→171 (evidence
`.coding-flow/runs/2026-11-25T20-08-40-297Z-verify.json`). Fixed in the same
commit: the no-checks answer moved to `pullRequestWithoutChecks` (`planBranch`
74 lines) and the dry-run merge lines to `logDryRunMerge` (`ship` 162); protect,
ship and layering tests pass alone (76/76). The fixed tree still needs its verify.

Series 2 round 2 fixes (fresh implementer): an unread base now reads
"Auto-merge: not armed — "main"'s protection could not be read (…). Next: …"
(README, `docs/rules-and-limits.md`, CHANGELOG follow). New or strengthened
fake-gh tests: refused write on an unprotected branch ("not protected", never
"left as is"); dry run on an unprotected base with no CI prints no `protect : `;
`manual` (no "Merge the PR once" when auto-merge is disabled or on a plan
limit); a base missing on GitHub says `push "main", then ship again`. Mutants,
each in a copy: `leftAsIs = !planLimit`, `wouldProtect: true`, the old wording,
`manual: false`, the missing-branch next step — each fails a new assertion;
44/44 pass on the real code.
