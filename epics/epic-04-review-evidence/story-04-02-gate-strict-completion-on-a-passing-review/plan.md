# Story 04-02 — Plan

## Implementation Context

- **Execution mode**: STRICT.
- **Scout pre-step**: no — builds directly on story-04-01's reader and the
  existing risk/finish-check functions; anchors below are already precise.
- **Likely files**:
  - `bin/lib/worktree-plan.js` — `chainIsFinished` (~line 228) is the exact
    function to extend: it already loops every chain member checking
    done/verified status + a green verify entry; add the same-shaped review
    check inside that loop, gated on the member's own risk tier.
  - `bin/lib/next.js` — the tier-4 "ready-to-ship" check (~line 97, the
    `claimsDone` block) — same extension, same reasoning pattern already used
    for "claims done but no captured verify" (~line 115-116).
  - `bin/lib/harness.js` — `combineRisk`/`scoreStoryRisk`/`scoreDiffRisk`
    (~line 557-627) is the risk computation to call, unchanged, from both call
    sites above. `buildHarnessPreflight` (~line 630) shows the exact call
    shape already in use (`combineRisk(scoreStoryRisk(storyText, config),
    scoreDiffRisk(changedFiles, config))`).
  - `bin/lib/status.js` — extend the `review` field story-04-01 added with the
    gate's own reason (none/fail/stale) when the story is STRICT, so a human
    reading `status` sees the same distinction auto-land/`next` act on.
- **Search anchors**: `chainIsFinished`'s existing loop body (worktree-plan.js
  ~line 245-263 — the `claimsDone`/`verifyEntry.ok` checks to extend, not
  restructure); `next.js`'s tier-4 messaging (~line 100-120, the
  `story.status === "blocked"` / not-proven branches, as the template for a
  new "needs review" branch).
- **Areas to avoid**: `worktree land`'s own precondition checks (epic-02,
  unchanged) — this story never touches what `land` itself validates, only
  what `chainIsFinished` decides *before* calling `land` at all (the same
  boundary story-03-02 already drew for auto-land's own preconditions).

## Technical Notes

- Risk tier is computed per chain member (a story can, in principle, carry a
  different risk than a sibling in the same chain — `scoreStoryRisk`/
  `scoreDiffRisk` are per-story computations already), so the review
  requirement is evaluated per member, then combined with "strictest member
  wins" for the chain-level decision — matching `combineRisk`'s own
  higher-wins philosophy rather than inventing a different aggregation rule.
- The review check is additive only: it never lowers or replaces the existing
  done/verified + green-verify requirement `chainIsFinished` already applies
  to every member regardless of tier. A STRICT member must satisfy both.

## Decisions

- **Gate at `chainIsFinished`/`next`'s tier-4 check, not inside
  `storage/local.js`'s `inferStoryStatus`.** `inferStoryStatus` is
  deliberately pure and story-scoped — it has no risk-tier awareness, and
  giving it one would mean recomputing `buildHarnessPreflight` (real file
  reads, diff scanning) inside what is today a pure string-derivation
  function, changing its cost and testing shape for every caller, including
  ones that do not care about review at all. The two places that already
  gate a real action on "done + green verify" (`chainIsFinished`, `next`'s
  tier-4 check) are the right layer to also gate on review — consistent with
  how "verified" itself is not one field `inferStoryStatus` alone produces,
  but a combination each consumer already computes from status + a
  separately-read verify entry.
- **Strictest-member-wins for a mixed-tier chain.** Considered requiring
  review per-member independent of the chain, and requiring it only for the
  chain's root — rejected both: a chain is landed as one unit (one merge), so
  a single unreviewed STRICT member anywhere in the chain is exactly the case
  this story exists to catch, regardless of which member it is.

- **Independent `/flow-review` pass (2026-08-29)**, given the artifact (the
  diff) and the contract (spec.md/Requirements) only, not the implementer's
  own reasoning: verdict pass, two P2s found and fixed, both efficiency —
  `next.js`'s `strictReviewGap` recomputed the same `combineRisk`-based score
  `buildStatusModel` had already produced as `story.reviewRequired`, and
  `status.js`'s `computeReviewRequired` recomputed `changedFilesForCoverage`
  (several `git` spawns) independently per story even when many stories share
  one root. Measured directly: `ai-flow status` ~117ms → ~495ms and `ai-flow
  next` ~230ms → ~680ms on this repository's own 7 done stories, before the
  fix. Fixed by having `next.js` reuse `story.reviewRequired` instead of
  recomputing, and adding `status.js`'s `diffRiskForRoot`, a cache shared
  across all stories within one `buildStatusModel()` call and keyed by root.
  Re-measured post-fix: `status` ~197ms, `next` ~226ms. `npm test`: 575/575
  throughout, no regressions from either fix.

- **Second independent `/flow-review` pass (2026-08-30)**: verdict pass. Two
  P2s found and fixed, both test-coverage gaps: the human-readable text for
  the three new auto-land failure reasons (`bin/ai-flow.js`'s
  `reviewGateMessages`) and `ai-flow status`'s `(required)` suffix
  (`status.js`'s `reviewSuffix`) were exercised by no test — every story-04-02
  test asserted on the `--json` path only. Negative-evidence check: disabling
  `reviewGateReason` locally made all three review-gate tests in
  `test/worktree-autoland.test.js` fail for the expected reason, confirming
  the gate itself (not just the tests) is real, before adding the missing
  text-path coverage. Fixed by adding text-mode (`json: false`) assertions to
  the three existing review-gate autoland tests and three new status-text
  tests; also corrected this file's Acceptance Traceability table, which had
  claimed a dedicated "non-STRICT regression guard" test that did not exist
  (the actual coverage is incidental, via a pre-existing unmodified test).
  `npm test`: 575/575.

## Test Plan

- Extend `test/worktree-autoland.test.js`'s existing real-temp-git-repo
  pattern: a STRICT-tier chain (a validation command/diff shape that scores
  `high`) with a green verify but no review evidence blocks `chainIsFinished`;
  adding a fresh-pass review evidence entry then unblocks it; a `fail`
  evidence blocks with the specific reason; a stale evidence blocks with the
  specific reason; a QUICK/STANDARD-tier chain in the same states is
  unaffected (regression guard against accidentally raising the floor for
  lower tiers).
- Extend `test/next.test.js`: a STRICT story missing a passing review is
  recommended `/flow-review`, not `land`/`ship`.

## Acceptance Traceability

| Criterion | Test |
|---|---|
| STRICT + green verify + no review blocks land | `test/worktree-autoland.test.js` — review-gate, missing case |
| STRICT + fresh-pass review unblocks | same file — review-gate, satisfied case |
| STRICT + fail review blocks with specific reason | same file — review-gate, fail case |
| STRICT + stale review blocks with specific reason | same file — review-gate, stale case |
| QUICK/STANDARD unaffected (no review evidence, low-risk diff) | same file — the pre-existing, unmodified "last story of a worktree'd chain lands" test (a low-risk diff, no review captured, still lands) |
| `next` recommends `/flow-review` for a STRICT story missing it | `test/next.test.js` — tier-4, review gate |

## Commands

```bash
npm test
```
