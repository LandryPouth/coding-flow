# Story 04-01 — Tasks

- [ ] Read `harness.js`'s `writeVerifyEvidence` and `audit.js`'s
      `latestVerifyByStoryDir`/`isStale` (targeted discovery — mirror the
      pattern, reuse `isStale` unchanged).
- [ ] Add `writeReviewEvidence(evidence)` (new, alongside `writeVerifyEvidence`
      or in a small sibling module if `harness.js` is already large — the
      implementer's call, matching how `placement-store.js` was split out when
      `worktree.js` grew) and `latestReviewByStoryDir(cwd)` in `audit.js`, with
      unit tests for both.
- [ ] Wire `ai-flow review capture --story <dir> --verdict pass|fail
      [--dimension ...] [--p0/--p1/--p2/--p3] [--reviewer self|subagent]
      [--json]` in `bin/ai-flow.js`.
- [ ] Surface a `review` field (`pass|stale|fail|none`) in `ai-flow status`,
      read from the story's own worktree path.
- [ ] Add the capture call to `skills/flow-review/SKILL.md`'s Output contract
      (and sync `templates/.claude/skills/flow-review/SKILL.md`, source of
      truth, via `ai-flow plugin sync`).
- [ ] Run `npm test`; capture the verify.

## Status: planned

## Result

### Rollback Notes

