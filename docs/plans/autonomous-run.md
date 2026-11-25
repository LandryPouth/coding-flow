# Autonomous run — epics 13 to 30 (from 2026-11-14)

The maintainer handed the backlog to an unattended run on 2026-11-14 ("je vais
te laisser tourner… jusqu'à mardi… tout devra être auto"). This file is the
run's single source of truth: the order, what runs in parallel, the rules,
and where it stands. A session that resumes the run reads this file first and
carries on from the first unchecked line — no question to the maintainer.

The order follows the delivery order in
[`autonomous-factory.md`](autonomous-factory.md) (revised 2026-11-13), with
the finishing work of epic 13 in front and the two-lane schedule made
explicit.

## How a story runs

The `epic-run` skill (`~/.claude/skills/epic-run/SKILL.md`), the manual
stand-in for epic 20:

1. Implementer agent in the story's worktree (`ai-flow worktree add --story`),
   TDD, `verify` until green, stops at `in-progress`.
2. A fresh independent reviewer (never the implementer); P0/P1 go back to the
   same implementer, then a re-review by a **new** reviewer (never the one
   that found the defects) on the story's whole diff: blind first, then given
   the earlier findings to confirm. Done when a fresh round finds no P0/P1;
   STRICT needs two clean rounds in a row. At most 4 rounds, then split or
   park the story. A contested P1 goes to a fresh skeptic first. (Since
   2026-11-22: a same-reviewer re-review passed what the next one failed.)
3. Close: `review capture`, `## Status: done`, unlock; land from the primary
   checkout with `ai-flow worktree land --story` (dry-run first); re-verify
   on `develop` with `--base <pre-land tip>` and re-capture the review (the
   land deletes the worktree's `runs/` until story 18-02 ships).
4. Tick the story below, commit.

## Rules

- At most 4 agents at once since 2026-11-24 (the maintainer: the machine is
  free; was 2), implementers and reviewers together; two stories run in
  parallel only when their files are disjoint.
- TMPDIR under the session scratchpad, never inside a repository.
- Every review brief says: experiments only in a throwaway repo, as
  `set -euo pipefail; D=$(mktemp -d) && cd "$D" && …` — never `;` after a
  mktemp or cd, never in the primary checkout (2026-11-22: a reviewer's failed
  mktemp ran its steps in the primary checkout and committed there; repaired).
- Never weaken or delete a test; never switch the primary checkout's branch;
  `trash`, not `rm`; English only; CHANGELOG `[Unreleased]` for every
  user-visible change.
- Circuit breaker: two environment failures, or two stories red on the same
  command → stop launching, diagnose read-only, write the cause here.
- A product decision the spec leaves open is decided by the run, written in
  the story's `plan.md` under Decisions, and listed in the run report — the
  maintainer reviews afterwards, not during.
- Memory vault (`~/dev/.ai-memory-vault`, read its `AGENTS.md` first): at
  every release and at every long stop, update the run note
  `workflows/epic-run/runs/2026-11-14-coding-flow-epics-13-30.md` and add or
  increment lessons in `workflows/epic-run/lessons.md` (`proposed` only), then
  commit `vault: …` there. Only those two places; never secrets, command output,
  code or absolute paths.
- Another session commits to `develop` (epic 29 was re-planned by one on
  2026-11-14): never commit files the run did not write.

## Releases

At the end of each wave marked *release*: cut the `[Unreleased]` section of
`CHANGELOG.md` into `## [x.y.z] - date` (minor bump), bump `package.json`,
commit on `develop`, push `develop`, open a PR `develop → main`, wait for the
checks, merge on green (main is unprotected: never `--auto`). `npm publish`
and `npm run release` (tag + GitHub release) stay with the maintainer — the
tag must follow npm (story 10-04).

## Order

### Wave 0 — finish epic 13 · *release 0.15.0*

- [x] 13-03 re-proved at its own commit
- [x] 13-09 a directory swap is a write (STRICT) — 5 reviews, landed, re-proved
- [x] 13-10 the security core stays high-risk — landed, re-proved, review re-captured
- [x] 13-11 a wrapped criterion is read whole — landed, re-proved, review re-captured
- [x] 13-12 a new function is measured as new — landed, re-proved, review captured
- [x] reviews of 13-03 / 13-05 / 13-06 captured, naming their follow-ups

### Wave 1 — before the factory · two lanes

Lane A (skills): epic 16, a chain.
- [x] 16-01 grilling rounds hold the request — landed, re-proved, review captured (20-05 reads its marker)
- [x] 16-02 a bug fix starts red — landed, re-proved, review captured
- [x] 16-03 writing-for-agents pass — 1 review (3 P2 fixed), landed, re-proved, review captured

Lane B (CLI): epic 17, a chain.
- [x] 17-01 archive one epic — landed, re-proved, review captured
- [x] 17-02 the index lists every epic — landed, re-proved, review captured
- [x] 17-03 epic numbers never collide — 2 reviews (1 P1, 9 P2 fixed), landed, re-proved, review captured
- [x] 17-04 archive coding-flow's own epics — epics 01–16 archived; 2 reviews (1 P1, 5 P2 fixed), review captured

### Wave 2 — no factory needed (step 0) · two lanes · *release 0.16.0*

Lane A: 26-06 `ai-flow rules` → 26-03 `docs check` → 26-07 we need you
Lane B: 19-05 fixers before the checks → 26-02 `ai-flow todo` (reader half) → 28-01 ideas

- [x] 26-06 `ai-flow rules` — split at the cap (series 1: 4 rounds, P1 2/1/1/2; init change → new 26-08); series 2: P1 1/0; landed, re-proved, review captured
- [ ] 26-03  - [ ] 26-07
- [x] 26-08 init shows the rules it applies (split from 26-06) — STRICT, 2 rounds (P1 0/0), landed, re-proved, review captured
- [x] 19-05 fixers run before the checks — re-scoped after 4 rounds; new series 4 rounds (P1 2/1/1/0), landed, re-proved, review captured
- [x] 19-10 the fixers test holds under load (from the flaky harness-fixers runs: index copy newer than the index) — 2 rounds (P1 1/0), landed, re-proved, review captured
- [x] 26-02 `ai-flow todo` (reader half; notify half after 24-02) — 4 rounds (P1 1/1/1/0), landed, re-proved, review captured
   - [ ] 28-01
- [x] 19-08 a reformatted test is not a stronger test — STRICT; series 1: 4 rounds (P1 every round) → re-scoped to a monotonic gate (efede92 verdict first); series 2: P1 1/1/0/0; landed, re-proved, review captured
- [x] 19-09 a failed review is cleared by a review (maintainer request 2026-11-24) — 1 review round (0 P1, 8 P2 fixed), landed, re-proved, review captured
- [x] 13-14 a deletion is a structural signal (QUICK; from 17-01's review) — landed, re-proved, review captured
- [x] 13-13 the guard's long tail (STRICT; follow-up of 13-09) — 3 reviews, landed, re-proved, review captured
- [x] 29-03 destructive commands wait for the human — claim re-scoped at the cap; 2 series × 4 rounds (new series P1 2/1/0/0, STRICT two clean), landed, re-proved, review captured
- [ ] 19-11 one tree is proved once (from this run, 2026-11-25: land skips its re-verify on a fast-forward; flow-run stops running the suite before verify) — next free agent slot
- [ ] 29-01 `ai-flow scan`
- [ ] 29-04 commands built to evade the guard (after 29-03; from its reviews)

### Wave 2b — one workspace, several repositories (epic 30) · *release 0.17.0*

Added 2026-11-22 at the maintainer's request (asked 2026-11-21 for tse-binam:
`api/` + `web/` in one container folder). After wave 2 because s3 judges
`ai-flow scan` (29-01) per repository and s4 extends the guard 29-03 changes.
The assumptions settled in each story's `plan.md` stand; the run lists them in
its report.

s1 first (walking skeleton), then s2 ∥ s3, then s4 ∥ s6, then s5 (needs s2's
per-repository branches).

- [ ] 30-01 a story is verified in each of its repos
- [ ] 30-02 each repo gets its worktree and lands (STRICT)  - [ ] 30-03 coverage and scan per repo
- [ ] 30-04 the workspace guard holds in each repo  - [ ] 30-06 a workspace is installed in one command
- [ ] 30-05 one PR per repo and a status that sees them

### Wave 3 — first driven run (step 1) · two lanes

Lane A (serial, the order the factory plan fixes): 18-01 journal → 19-01 a
red names its tests → 29-02 changed tests run → 19-07 tests read-only →
20-01 one story headless.
Lane B (the run's own friction first): 18-02 proof survives the land →
18-07 worktrees are a setting → 18-03 notes-only edit keeps the proof →
18-06 a ticked criterion names its proof.

- [ ] 19-03 one heavy verify per machine — pulled forward 2026-11-24 (maintainer): slots for heavy runs, agents unlimited otherwise
- [ ] 18-01  - [ ] 19-01  - [ ] 29-02  - [ ] 19-07  - [ ] 20-01
- [ ] 18-02  - [ ] 18-07  - [ ] 18-03  - [ ] 18-06

### Wave 4 — the rest of 18 → 19 → 20 · *release 0.18.0*

- [ ] 18-04 ∥ 19-03 → 18-05 (after 18-02) ∥ 19-04
- [ ] 19-02 (after 19-01) ∥ 19-06 (after 19-05)
- [ ] 20-02 → 20-03 → 20-04 → 20-05 → 20-06 → 20-07 (a chain)

### Wave 5 — the run knows why it stopped (step 3) · *release 0.19.0*

- [ ] 27-01, then 27-02…27-07 two at a time
- [ ] 26-01, 26-05
- [ ] 24-01, 24-02 → 26-02 (notify half, needs 24-02's global config), 24-07 → 26-04 → epic 25

### Wave 6 — learning (step 4) · *release 0.20.0*

- [ ] epic 21 → epic 22 → epic 23 → 28-02 → 24-03…24-06 (team; re-read
      against the first driven runs before starting)
- Epic 22 now ends with 22-08 (a friction becomes a finding) and 22-09 (a
  rule nobody needs is retired), added 2026-11-22; both run inside epic 22's
  chain, after 22-07.

## Log

- 2026-11-14 — run handed over; plan written; wave 0 in progress.
- 2026-11-14 ~07:30 — usage limit reached mid-run. State at stop:
  - 13-12 and 16-01: done and reviewed, being landed by the scratchpad
    script `land.sh` (merge develop into the story branch → verify → land
    fast-forward → re-verify on develop with `--base`). If not landed on
    resume: run it again per story; then re-capture each review on develop.
    Never commit to develop while a land is in flight (it breaks the ff).
  - 17-01: fixing its review (2 P1: unknown statuses archived; recovery SHA
    may vanish) — then re-review, close, land.
  - 13-14: implemented, verify green, independent review running.
  - Still to capture on develop: reviews of 13-03/13-05/13-06 naming their
    follow-ups (13-09/13-10, 13-11, 13-12).
  - Then: 16-02, 17-02, … per the order above; release 0.15.0 at the end of
    wave 0.
- Later at the stop: 13-14 review PASS (5 P2) — its implementer fixes P2-1
  and closes; land it with `land.sh`. 17-01 fixed both P1s (verify green at
  `6ffb2a0`) — needs its re-review (same brief), then close and land.
  Follow-up worth planning from 13-14's review: deletion signal via
  `execFileSync("git", …)`/`git -C`, options by variable, `allowFail` should
  not exempt a deletion, skip lines > 2000 chars in the risk regexes.
- 2026-11-14 08:30 — resumed: 13-12 and 16-01 landed and re-proved; reviews of
  13-03/05/06/12 and 16-01 captured on develop. Wave 0 left: 13-14 (closing).
- 2026-11-14 ~10:00 — 16-02, 17-01, 13-14, 13-13 and 17-02 landed, re-proved,
  reviews captured on develop. 16-03's implementer was stopped mid-verify (its
  benchmark run and write-up are committed on its branch); the run re-runs its
  verify, then the independent review.
- 2026-11-22 — resumed after a pause. Epic 30 (one workspace, several
  repositories) was planned by another session on 2026-11-21; its index says
  it is not part of this run (the maintainer schedules it). Release 0.15.0 is cut now
  (wave 0 done, plus what wave 1 landed).
- 2026-11-22 — 16-03 reviewed (PASS, 3 P2 fixed by the run), landed, re-proved.
  Lane A of wave 1 is done. Release 0.15.0 cut (epics 13, 16, 17-01/02).
  The scratchpad was cleared during the pause: `land.sh` was rewritten from
  this file's description. Next: 17-03, then 17-04 alone, then wave 2.
- 2026-11-22 — epic 30 added to the run as wave 2b at the maintainer's request
  (it was out of the run when planned); later releases shift by one minor.
- 2026-11-22 — stories 22-08 and 22-09 planned at the maintainer's request
  (what to keep from "Améliorez votre IA de 1 % par jour"); wave 6, inside
  epic 22. Windows CI of PR #59: drive letters and the red-at-base sweep fixed
  (2 reviews, 1 P1), pushed; waiting for green.
- 2026-11-22 — wave 2 started while PR #59's Windows job runs: 19-05 ∥ 29-03
  (disjoint files). 26-06 shares `validation-run.js` and `config.js` with
  19-05, so it runs after 19-05 lands, not beside it. 17-04 archives epics 13,
  16 and 17 only (no open worktree there), once main has 0.15.0 and an agent
  slot is free.
- 2026-11-22 — review rule changed (maintainer): every re-review is a new
  reviewer on the whole diff; STRICT needs two clean rounds; cap 4. Same
  change planned in 20-04 (rounds, `review-not-converging`) and 21-04 (yield
  per round); the `epic-run` skill updated.
- 2026-11-22 — release 0.15.0 merged to main (PR #59, merge 2592244) after four
  CI rounds; `npm publish` and `npm run release` are the maintainer's. Vault
  run note and lessons updated. 17-04 next, when an agent slot frees.
- 2026-11-22 — incident: 19-05's second reviewer committed a test config on
  develop (8f7fe8f, local only, 3 min) after its mktemp failed; it reset to
  1f58d2f and restored the file; checked clean. Review briefs now require
  `set -euo pipefail` experiments. 19-05 round 2: FAIL (new P1, fixers alone
  gave a green verify).
- 2026-11-23 — 19-05 hit the review cap (4 rounds, a new P1 each). Re-scoped:
  the fixer-only exclusion is removed (it made proof depend on run state);
  the gate's "neutral counts as strengthened" rule moves to new story 19-08,
  after 19-05 in lane B. 19-05 restarts its review series once re-scoped.
  29-03 round 2: FAIL (5 P1, same class as round 1) — asked for fail-safe
  defaults per class. Machine slowed by an unrelated long-running next-server.
- 2026-11-23 18:10 — run paused by the maintainer ("arrête tout"). State:
  - 19-05 (re-scoped): round-1 fixes committed (d7fbef3); its verify was
    interrupted. On resume: re-run verify, then round 2 by a new reviewer.
  - 29-03: round-3 backstops (only modeled syntax allowed; destructive text
    handed to a non-inert command is unchecked) written but UNCOMMITTED in its
    worktree; full suite was interrupted. On resume: run the suite, commit,
    verify, then round 4 (the last) by a new reviewer.
  - 17-04 waits for an agent slot; 19-08 planned after 19-05; 26-06 after 19-05.
  - Heartbeat cron deleted; recreate it on resume.
- 2026-11-24 — resumed ("continue et termine tout"); max agents 4. The
  machine rebooted: scratchpad empty, land.sh rewritten (branch -d).
- 2026-11-24 — 29-03 hit the review cap (4 rounds, new bypasses each). Claim
  re-scoped (run decision, for the maintainer to review): the guard refuses
  habitual destructive forms and marks unchecked what it cannot read; forms
  built to evade it are the sandbox's job. Round 4's 4 P1 fixed anyway;
  evasion forms moved to new story 29-04. 29-03 restarts a review series
  under the new claim. 17-04: epics 01–16 archived on develop.
- 2026-11-24 — 17-04 done. Epics 01–16 are archived on develop (436 → 247
  files in `epics/`). 19 references now point to their INDEX entry. INDEX
  entries carry their marker above the heading, and `archive` tells links
  apart from mentions. Review: round 1 FAIL (1 P1, doctor out of date),
  round 2 PASS.
- 2026-11-24 — maintainer asked that a failed review be cleared only by a new
  review, not by verify. epic-run already does it (step 4b); Coding Flow did
  not. New story 19-09 (guard in `review capture`, skills paragraph), run now
  ahead of 20-04, which keeps the automatic rounds.
- 2026-11-24 — 19-05 landed (verify runs the declared fixers first; a fixer
  write to tests, story roots or `.coding-flow/` is red; real prettier 3
  checked by the last reviewer). Two review series: 4 rounds, re-scope, 4 rounds.
- 2026-11-24 — 19-09 landed: `review capture` refuses a pass right after a
  fail without `--round`; STRICT needs two passes in a row. The first land
  verify went red with no failing test (machine loaded: three suites at once,
  the suite took 11 min instead of 4); the retry was green.
- 2026-11-24 — 29-03 landed. The guard refuses the destructive forms an agent
  writes by habit (rm -rf, reset --hard, clean -f, push --force, branch -D,
  checkout/restore on a dirty tree, stash drop, migrate reset, DROP DATABASE…),
  names the safe alternative, and marks unchecked what it cannot read; evasion
  forms are 29-04's. land.sh no longer uses `branch -f`.
- 2026-11-24 — the land re-verifies of 19-09 and 29-03 went red under load
  (load average 12–20, three suites at once, suite 4 → 11 min) with no failing
  test the run could name: `npm test` and a coverage run on develop were green
  (1906/1906), and a third verify on develop was green. verify does not name
  the failing test yet — that is 19-01, which this makes urgent. Until then:
  at most two suites at once during a land.
- 2026-11-24 — maintainer: limit the heavy runs, not the agents. 8 cores, 13 GB,
  load 20+ with four suites (node --test runs ~7 workers each). Interim until
  19-03 ships: every `npm test` / `verify` of the run goes through a
  machine-wide slot wrapper (2 slots; the run's scratchpad `heavy.sh`, also used
  by `land.sh`); agents themselves are not capped by load, only by the run's
  max. 19-03 pulled to the head of wave 3.
- 2026-11-25 — the flaky `harness-fixers` test was a real bug (index copy newer than
  the index, so git skipped its racy re-read): story 19-10, in review. land.sh: the
  slot wrapper's wait lines must not count toward the output it keeps.
- 2026-11-25 — `worktree land` needs the story's directory on the base branch: a story
  created inside its own branch (19-10, 29-05) cannot land until its story file is
  copied to develop first. Tool gap — follow-up for epic 20 (the epic runs itself).
- 2026-11-25 — fewer redundant full suites (15 verifies in 3 h kept both heavy slots full):
  agents run `verify` only (no `npm test` before it; targeted tests while fixing) and stop
  merging develop on every land; the land step merges develop, verifies the story only if
  that merge changed it (`worktree land` refuses a stale or red verify), and skips the
  post-land verify when develop's tree equals the proved story tree. A code conflict at land
  sends the story back for review. Review cap stays 4 rounds per series: a STRICT story that
  fails round 4 is parked with its findings, not given a third series.
