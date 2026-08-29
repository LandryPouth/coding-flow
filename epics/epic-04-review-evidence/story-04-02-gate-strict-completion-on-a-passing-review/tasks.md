# Story 04-02 — Tasks

- [ ] Read `chainIsFinished` (`worktree-plan.js`), `next.js`'s tier-4 check,
      and `combineRisk`/`scoreStoryRisk`/`scoreDiffRisk` (`harness.js`)
      (targeted discovery — reuse the risk computation and the existing
      done/verified + verify checks, extend rather than restructure).
- [ ] Extend `chainIsFinished` to require, per STRICT-tier member, a fresh,
      passing review evidence entry (story-04-01's reader) alongside the
      existing done/verified + green-verify check; strictest-member-wins for
      the chain-level decision.
- [ ] Extend `next.js`'s tier-4 check with the same requirement and a
      dedicated "needs review" recommendation.
- [ ] Surface the gate's specific reason (none/fail/stale) in `ai-flow
      status`'s existing `review` field for STRICT stories.
- [ ] Run `npm test`; capture the verify.

## Status: planned

## Result

### Rollback Notes

