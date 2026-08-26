# Tasks — Story 02-03

- [x] Targeted discovery: re-read `story-02-02`'s finished `worktreeLand`,
      `harness.js`'s `verifyStoryOnce`/`writeVerifyEvidence`/
      `resolveValidationCommands`, and `audit.js`'s "(repo)" grouping in
      `gate()`.
- [x] Capture the target branch's pre-merge SHA before the merge attempt.
- [x] Insert the post-merge re-verify (`verifyStoryOnce({ story: null })` +
      `writeVerifyEvidence`), running in the target checkout.
- [x] On green: move the existing worktree/branch/lock cleanup to run here
      (after the re-verify, not immediately after the merge).
- [x] On red: `git reset --hard` the target branch to the captured SHA,
      leave the story worktree/branch/lock untouched, report the failing
      command/output.
- [x] Write tests per `plan.md`.
- [x] Run `npm test`; fix; capture verify.

## Status: done

## Result

`worktreeLand` (`bin/lib/worktree.js`) now captures the target branch's HEAD
before attempting the merge, and — once the ff-only merge succeeds (directly
or after the rebase-replay fallback) — always re-runs the project's declared
validation commands against the merged target checkout via
`verifyStoryOnce({ story: null })`, before the existing worktree/branch/lock
cleanup runs (moved to fire only after a green re-verify, not immediately
after the merge). The re-verify is unconditional: nothing in the code path
reads the story's own risk tier.

On green: `writeVerifyEvidence` persists the evidence (`story: null`, the
"(repo)" shape `audit.js`'s `gate()` already groups by), `printVerify`
(newly exported from `harness.js`, reused rather than reinvented) reports it,
and cleanup proceeds exactly as `story-02-02` left it.

On red: the same evidence is written and printed first (so a failed re-verify
is exactly as visible as any other captured verify — `ai-flow audit` picks it
up as a failed ledger entry, confirmed manually), then `git reset --hard` puts
the target branch back at the exact pre-merge commit. The story's own
worktree, branch, and lock are never touched — only the merge commit `land`
just created is undone, so the fix happens where the story's commits already
live and a retry is a plain `land` call with no state to clean up first.

All 5 acceptance criteria are covered by 5 new tests in `test/worktree.test.js`
(green re-verify + evidence, red re-verify + exact rollback + story worktree
untouched, retry after rollback succeeding through the rebase-replay path,
and a QUICK-tier story rolling back identically), plus evidence assertions
added to the existing ff-only land test. `repoWithStory`'s fixture now
declares a real (executable) validation command in `.coding-flow/config.json`
so the re-verify has something genuine to run; the two pre-existing
merge-success tests needed no behavior changes beyond that, since the
re-verify runs unconditionally on the path they already exercise.

`ai-flow verify --story epics/epic-02-worktree-story-landing/story-02-03-verify-and-roll-back-a-landed-story`
is green (`npm test`, 480/480 passing, `Coverage: evidence`). `harness
check`/`harness evidence` fail on this repo's own tree the same way
story-02-02 already found and logged (`docs/DOGFOODING.md`, 2026-08-24 row):
`test/guard.test.js`/`test/harness.test.js` carry intentional secret-shaped
fixtures, `--story` does not scope `check`'s scan, and neither file is part
of this diff — same pre-existing, unrelated failure, not a new one.

### Rollback Notes

- Files changed: `bin/lib/worktree.js` (re-verify + rollback inserted into
  `worktreeLand`), `bin/lib/harness.js` (`printVerify` newly exported, no
  behavior change), `test/worktree.test.js` (new tests + fixture helper
  changes only).
- No schema, config, or data migration involved.
- No feature flag: the re-verify is unconditional by design (that is the
  point of the story), so there is no prior behavior to preserve behind a
  flag — `git revert` of the commit fully restores `story-02-02`'s land
  (merge + immediate cleanup, no re-verify).
- Manual cleanup if a real red re-verify is hit in practice (not a bug, the
  designed stop condition): none needed on the target — the reset already
  restores it exactly. Fix the underlying failure in the story's own
  worktree (still present, untouched) and run `land` again.

### Post-review correction

`/flow-review` found the re-verify (`verifyStoryOnce({ story: null })`) pulled
in the coverage/test-change gate by default, scoped to the diff from `main` to
`HEAD` — every story's accumulated diff on the target branch, not just the one
just landed — and unable to see a story-scoped test exemption an earlier,
already-landed story had legitimately used. A later, unrelated land could roll
back on stale risk instead of on the actual combination this story exists to
catch, and none of the original 5 tests exercised it (the fixtures' `repo`
never leaves `main`, so `changedFilesForCoverage` was always empty).

Fixed: `verifyStoryOnce` gained a `skipCoverage` option (`bin/lib/harness.js`);
`worktreeLand` now calls it with `skipCoverage: true`, so the re-verify judges
only the declared commands — what the spec names — and leaves coverage a
per-story concern. Added
`test/worktree.test.js`'s "judges the post-land re-verify on its declared
commands only" test: an already-landed migration file with no test file on
the target must not roll back an otherwise-green land. Confirmed the test
fails without `skipCoverage` and passes with it. `npm test`: 481/481 green.
