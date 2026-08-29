# Story 04-01 — Tasks

- [x] Read `harness.js`'s `writeVerifyEvidence` and `audit.js`'s
      `latestVerifyByStoryDir`/`isStale` (targeted discovery — mirror the
      pattern, reuse `isStale` unchanged).
- [x] Add `writeReviewEvidence(evidence)` (in a new sibling module,
      `bin/lib/review.js` — matching how `placement-store.js` was split out
      when `worktree.js` grew) and `latestReviewByStoryDir(cwd)` in
      `audit.js`, with unit tests for both.
- [x] Wire `ai-flow review capture --story <dir> --verdict pass|fail
      [--dimension ...] [--p0/--p1/--p2/--p3] [--reviewer self|subagent]
      [--json]` in `bin/ai-flow.js`.
- [x] Surface a `review` field (`pass|stale|fail|none`) in `ai-flow status`,
      read from the story's own worktree path.
- [x] Add the capture call to `skills/flow-review/SKILL.md`'s Output contract
      (and sync `templates/.claude/skills/flow-review/SKILL.md` by hand — no
      `ai-flow plugin sync` command exists for a single skill file; copied
      directly since both must stay byte-identical).
- [x] Run `npm test`; capture the verify.
- [x] Independent `/flow-review` pass (artifact + contract only): one P2
      fixed (`--story` scope guard), one P2 flagged as a residual risk out
      of scope (worktree land discards review evidence) — see plan.md
      Decisions.

## Status: done

## Result

- **Changed**: added `ai-flow review capture --story <dir> --verdict
  pass|fail [--architecture|--tests|--security|--quality|--e2e
  quick|deep|skipped] [--p0/--p1/--p2/--p3] [--reviewer self|subagent]
  [--json]` (`bin/lib/review.js`, wired in `bin/ai-flow.js`), writing a
  review evidence file under `.coding-flow/runs/*-review.json` — same
  directory, same provenance shape (`identity.js`'s `captureIdentity`,
  unchanged) as verify evidence. `audit.js` gained `latestReviewByStoryDir`,
  mirroring `latestVerifyByStoryDir` exactly in shape and multi-run
  resolution, reusing `isStale` unchanged for freshness. `status.js` gained a
  `review` field (`pass`/`stale`/`fail`/`none`) per story, read from the
  story's own worktree when one exists, `cwd` otherwise — shown in both text
  and `--json` output. `skills/flow-review/SKILL.md` (and its synced
  `templates/` copy) now call `review capture` as the final step of the
  Output contract.
- **Verify**: green (`npm test`, 519/519; `ai-flow verify --story
  epics/epic-04-review-evidence/story-04-01-capture-durable-review-evidence`
  — 1 command via `ai-flow verify`). Coverage: evidence (2 test files
  changed alongside 5 behavior files; no lcov/coverage report emitted by
  this project's `npm test`, so `evidence` is a proxy, not a measurement).
  `harness check` reports pre-existing failures in `test/guard.test.js`/
  `test/harness.test.js` (fake secret fixtures, unrelated to this diff,
  already logged in `docs/DOGFOODING.md` 2026-08-18 as unfixable without a
  precision:"exact" allowlist).
- **Independent review**: one P2 fixed (`review capture` was missing the
  `epics/`-or-`specs/` scope guard `verify --story` already applies to the
  same input — see plan.md Decisions), one P2 flagged as a residual risk out
  of this story's stated scope (worktree land discards review evidence on
  cleanup, with no re-capture the way it has for verify evidence) — logged
  in `docs/DOGFOODING.md` for story-04-02 to account for.
- **Second independent `/flow-review` pass (2026-08-29, fresh session)**:
  verdict pass, two P3s applied (both non-blocking, no correctness issue
  found): extracted `writeTimestampedEvidence(dir, suffix, evidence)` into
  `util.js` — `writeVerifyEvidence` (harness.js) and `writeReviewEvidence`
  (review.js) had hand-copied the identical mkdir+timestamp+collision-loop
  mechanism, generic file-naming plumbing unrelated to the verify/review
  domain separation plan.md's Decisions section deliberately keeps distinct
  — and added the one untested branch, an unknown/missing `review`
  subcommand, to `test/review.test.js`. `npm test`: 520/520 (was 519/519 —
  one new test, no regressions).

### Rollback Notes

- Purely additive: a new command (`review capture`), a new reader
  (`latestReviewByStoryDir`), and one new field (`review`) on `status`'s
  existing story objects. Nothing gates on this evidence yet (story-04-02),
  so `git revert` needs no data migration or feature-flag rollback path —
  any already-written `*-review.json` files are simply inert JSON `status`
  stops reading.

