# Autonomous run — epics 13 to 29 (from 2026-11-14)

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
   same implementer, then a re-review.
3. Close: `review capture`, `## Status: done`, unlock; land from the primary
   checkout with `ai-flow worktree land --story` (dry-run first); re-verify
   on `develop` with `--base <pre-land tip>` and re-capture the review (the
   land deletes the worktree's `runs/` until story 18-02 ships).
4. Tick the story below, commit.

## Rules

- At most 2 agents at once (implementers and reviewers together); two lanes
  run in parallel only when their files are disjoint.
- TMPDIR under the session scratchpad, never inside a repository.
- Never weaken or delete a test; never switch the primary checkout's branch;
  `trash`, not `rm`; English only; CHANGELOG `[Unreleased]` for every
  user-visible change.
- Circuit breaker: two environment failures, or two stories red on the same
  command → stop launching, diagnose read-only, write the cause here.
- A product decision the spec leaves open is decided by the run, written in
  the story's `plan.md` under Decisions, and listed in the run report — the
  maintainer reviews afterwards, not during.
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
- [ ] 16-02 a bug fix starts red
- [ ] 16-03 writing-for-agents pass (after s1, s2)

Lane B (CLI): epic 17, a chain.
- [ ] 17-01 archive one epic
- [ ] 17-02 the index lists every epic
- [ ] 17-03 epic numbers never collide
- [ ] 17-04 archive coding-flow's own epics — alone, when no worktree is open

### Wave 2 — no factory needed (step 0) · two lanes · *release 0.16.0*

Lane A: 26-06 `ai-flow rules` → 26-03 `docs check` → 26-07 we need you
Lane B: 19-05 fixers before the checks → 26-02 `ai-flow todo` (reader half) → 28-01 ideas

- [ ] 26-06  - [ ] 26-03  - [ ] 26-07
- [ ] 19-05  - [ ] 26-02 (todo)  - [ ] 28-01
- [ ] 13-14 a deletion is a structural signal (QUICK; from 17-01's review)
- [ ] 13-13 the guard's long tail (STRICT; follow-up of 13-09)
- [ ] 29-03 destructive commands wait for the human ∥ 29-01 `ai-flow scan`

### Wave 3 — first driven run (step 1) · two lanes

Lane A (serial, the order the factory plan fixes): 18-01 journal → 19-01 a
red names its tests → 29-02 changed tests run → 19-07 tests read-only →
20-01 one story headless.
Lane B (the run's own friction first): 18-02 proof survives the land →
18-07 worktrees are a setting → 18-03 notes-only edit keeps the proof →
18-06 a ticked criterion names its proof.

- [ ] 18-01  - [ ] 19-01  - [ ] 29-02  - [ ] 19-07  - [ ] 20-01
- [ ] 18-02  - [ ] 18-07  - [ ] 18-03  - [ ] 18-06

### Wave 4 — the rest of 18 → 19 → 20 · *release 0.17.0*

- [ ] 18-04 ∥ 19-03 → 18-05 (after 18-02) ∥ 19-04
- [ ] 19-02 (after 19-01) ∥ 19-06 (after 19-05)
- [ ] 20-02 → 20-03 → 20-04 → 20-05 → 20-06 → 20-07 (a chain)

### Wave 5 — the run knows why it stopped (step 3) · *release 0.18.0*

- [ ] 27-01, then 27-02…27-07 two at a time
- [ ] 26-01, 26-02 (notify), 26-05
- [ ] 24-01, 24-02, 24-07 → 26-04 → epic 25

### Wave 6 — learning (step 4) · *release 0.19.0*

- [ ] epic 21 → epic 22 → epic 23 → 28-02 → 24-03…24-06 (team; re-read
      against the first driven runs before starting)

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
