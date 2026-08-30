# Story 04-02 — Gate STRICT completion on a passing review

## User Value

A STRICT-tier story with a green verify but no fresh, passing review is no
longer treated as finished — auto-land refuses it, and `ai-flow next` names
review as the missing step, instead of both silently reading "green verify"
as "done." QUICK/STANDARD stories are unaffected: review stays opt-in there,
exactly as `flow-run/SKILL.md` already describes.

## Requirements

- Depends on story-04-01's `latestReviewByStoryDir` reader and `isStale`
  reuse.
- Compute a story's risk tier the same way `buildHarnessPreflight`
  (`bin/lib/harness.js`) already does — `combineRisk(scoreStoryRisk(...),
  scoreDiffRisk(...))` — never a second, independent risk model.
- `bin/lib/worktree-plan.js`'s `chainIsFinished`: for any chain member whose
  own risk tier resolves to STRICT (`combineRisk(...).level === "high"`),
  also require a review evidence entry that is `ok: true` (`verdict: "pass"`)
  and fresh (`!isStale(entry, currentToken)`) — not just the existing
  done/verified status + green verify check. A STANDARD/QUICK member is
  unaffected; the existing check is the only one applied to it.
- `bin/lib/next.js`'s tier-4 "ready-to-ship" check: the same extension — a
  STRICT story with done/verified status and a green verify but no
  fresh-passing review is surfaced as its own actionable item (recommending
  `/flow-review`), not silently folded into "ready to ship."
- Failure/no-op reasons name exactly what's missing: no review ever captured,
  review evidence recorded `fail`, or review evidence exists but is stale —
  three distinct messages, mirroring the existing distinction between "no
  captured verify" and "stale verify" in `next.js`'s own messaging.

## Acceptance Criteria

- [x] Given a STRICT-tier story with a green, fresh verify but no captured
      review evidence, when `chainIsFinished` runs, then the chain reports
      not-finished, reason names "no review captured," and no land is
      attempted.
- [x] Given that same story now has a fresh, passing review evidence entry,
      when `chainIsFinished` runs again (with every other chain member
      already satisfying the existing check), then the chain reports
      finished.
- [x] Given a STRICT-tier story's review evidence records `verdict: fail`,
      when `chainIsFinished` runs, then not-finished, reason names the review
      failure specifically (not conflated with "no review" or "stale").
- [x] Given a STRICT-tier story's review evidence exists but is stale (the
      tree changed since capture), when `chainIsFinished` runs, then
      not-finished, reason names staleness specifically.
- [x] Given a QUICK or STANDARD story in any of the above review states, when
      `chainIsFinished`/`next`'s tier-4 check runs, then review is not
      required at all — behavior is identical to before this story.
- [x] Given `ai-flow next` evaluates a STRICT story with done/verified status,
      a green verify, but no fresh-passing review, then it recommends running
      `/flow-review` next, not `worktree land`/`ship`.

## Edge Cases

- **Correctness**: a chain whose members span different risk tiers uses the
  strictest tier among them for the review requirement — the same
  "higher wins" principle `combineRisk` itself already applies within a
  single story's own story-vs-diff risk.
- **Concurrency**: none new — this story only adds a read (review evidence)
  to an already-read-only check (`chainIsFinished` performs no writes itself);
  no new lock or race surface.
- **Data**: review evidence is read by story path, the same keying verify
  evidence already uses — no new story-to-evidence mapping to get wrong.
- **UX**: the three missing-review reasons (none/fail/stale) must be
  distinguishable in both auto-land's failure output and `next`'s
  recommendation text — a human deciding what to do next must not have to
  guess which one applies.

## Out of Scope

- Any change to `worktree land`'s own merge/rebase/rollback mechanics —
  reused exactly as epic-02/epic-03 built them.
- Gating QUICK/STANDARD stories — explicitly not raised by this story.
- Changing how risk tier itself is computed — story-04-03 improves the
  signals `scoreDiffRisk` reads, but the computation this story calls is
  the existing `combineRisk`/`scoreStoryRisk`/`scoreDiffRisk`, unchanged by
  this story.
