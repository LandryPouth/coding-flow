# Story 04-02 — Tasks

- [x] Read `chainIsFinished` (`worktree-plan.js`), `next.js`'s tier-4 check,
      and `combineRisk`/`scoreStoryRisk`/`scoreDiffRisk` (`harness.js`)
      (targeted discovery — reuse the risk computation and the existing
      done/verified + verify checks, extend rather than restructure).
- [x] Extend `chainIsFinished` to require, per STRICT-tier member, a fresh,
      passing review evidence entry (story-04-01's reader) alongside the
      existing done/verified + green-verify check; strictest-member-wins for
      the chain-level decision.
- [x] Extend `next.js`'s tier-4 check with the same requirement and a
      dedicated "needs review" recommendation.
- [x] Surface the gate's specific reason (none/fail/stale) in `ai-flow
      status`'s existing `review` field for STRICT stories.
- [x] Run `npm test`; capture the verify.
- [x] Independent `/flow-review` pass (artifact + contract only): verdict
      pass. Two P2s found and fixed in the same pass (see plan.md Decisions).

## Status: done

## Result

- **Changed**: `chainIsFinished` (`bin/lib/worktree-plan.js`) now returns
  `{finished, reason, story?}` instead of a plain boolean — for any chain
  member whose own risk tier resolves to STRICT (`combineRisk(scoreStoryRisk(...),
  scoreDiffRisk(...))`, the exact computation `buildHarnessPreflight` already
  uses), it also requires a fresh, passing review evidence entry
  (story-04-01's `computeReviewStatus`), returning one of three distinct
  reasons — `review-missing`, `review-stale`, `review-failed` — alongside the
  pre-existing `chain-not-finished`. `autoLandIfChainFinished` and `ai-flow
  worktree autoland`'s text/JSON output propagate the specific reason.
  `next.js`'s tier-4 check gained a new, separate `needs-review` tier (4,
  pushing the pre-existing `ready-to-ship`/`planned` tiers to 5/6) so a STRICT
  story missing review is recommended `/flow-review`, never folded into
  "ready to ship." `ai-flow status` gained a `reviewRequired` boolean per
  `done`/`verified` story (text output shows `(required)` next to a
  non-passing review). `harness.js`'s `harnessConfigPath`/`readHarnessConfig`/
  `runGitList`/`getChangedFiles`/`changedFilesForCoverage` gained an optional
  `root` parameter (default: the module's own `cwd`, so every existing call
  site is unaffected) so a story living in a different worktree than the
  process itself can be scored — `scoreStoryRisk`/`readStoryBundle`/
  `changedFilesForCoverage` are now exported alongside the pre-existing
  `scoreDiffRisk`/`combineRisk`.
- **Verify**: green (`npm test`, 575/575; `ai-flow verify --story
  epics/epic-04-review-evidence/story-04-02-gate-strict-completion-on-a-passing-review`
  — 1 command via `ai-flow verify`). Coverage: evidence (9 test files changed
  alongside 12 behavior files; no lcov/coverage report emitted by this
  project's `npm test`, so `evidence` is a proxy, not a measurement).
  `harness check` reports the same pre-existing failures in
  `test/guard.test.js`/`test/harness.test.js` (fake secret fixtures,
  unrelated to this diff) already logged in `docs/DOGFOODING.md` 2026-08-18.
- **Independent review**: two passes (artifact + contract only), both verdict
  pass.
  - Pass 1: two P2s found and fixed, both efficiency: `next.js`'s
    `strictReviewGap` and `status.js`'s `computeReviewRequired` each
    independently recomputed the same `changedFilesForCoverage`-based risk
    score per story — measured `ai-flow status` going from ~117ms to ~495ms
    and `ai-flow next` from ~230ms to ~680ms on this repository's own 7 done
    stories. Fixed: `next.js` now reuses `story.reviewRequired` (already
    computed once by `buildStatusModel`) instead of recomputing; `status.js`
    gained a `diffRiskForRoot` cache shared across all stories in one
    `buildStatusModel()` call, keyed by root (many stories typically share one
    root). Post-fix: `status` ~197ms, `next` ~226ms — back near baseline.
  - Pass 2 (2026-08-30): two P2s found and fixed, both test-coverage gaps —
    the human-readable text for the three auto-land failure reasons
    (`bin/ai-flow.js`) and `status`'s `(required)` suffix (`status.js`) were
    exercised by no test (every prior test asserted on `--json` output only).
    Verified the gate itself was real (not just the tests) by disabling
    `reviewGateReason` locally and confirming all three review-gate autoland
    tests failed for the expected reason, then restored it. Fixed by adding
    text-mode assertions to the three existing autoland review-gate tests and
    three new status-text tests; corrected this story's plan.md Acceptance
    Traceability table, which had claimed a "non-STRICT regression guard"
    test that did not exist. Re-verified: 578/578.

### Rollback Notes

- Purely additive to the review-evidence layer story-04-01 built: a new
  `reason` shape on `chainIsFinished`'s return value (callers already handled
  only via `autoLandIfChainFinished`, updated in the same commit), a new
  `next.js` tier (renumbering `ready-to-ship`/`planned` from 4/5 to 5/6 — no
  test or caller asserted those numbers directly, only the JSON tier of
  `blocked` at 1), and a new `reviewRequired` field on `status`'s existing
  story objects. `git revert` needs no data migration: no evidence shape
  changed, only what reads it and what it additionally requires.

