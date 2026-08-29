# Story 04-01 — Plan

## Implementation Context

- **Execution mode**: STRICT.
- **Scout pre-step**: no — anchors below are already precise; no broad
  discovery needed.
- **Likely files**:
  - `bin/lib/harness.js` — `writeVerifyEvidence` (~line 2178) is the shape to
    mirror for a new `writeReviewEvidence(evidence)`; same `.coding-flow/runs/`
    directory, same `${timestamp}-<kind>.json` naming convention (`-review.json`
    suffix, parallel to `-verify.json`).
  - `bin/lib/audit.js` — `latestVerifyByStoryDir` (~line 322) and `isStale`
    (~line 288) are the reader/freshness pair to mirror/reuse. Add
    `latestReviewByStoryDir` next to it, reading `*-review.json` files the same
    way; call the existing `isStale` unchanged rather than writing a second
    version.
  - `bin/ai-flow.js` — new `review capture --story <dir> --verdict pass|fail
    [--dimension <name>=<quick|deep|skipped> ...] [--p0 N --p1 N --p2 N --p3 N]
    [--reviewer self|subagent] [--json]` subcommand, wired directly (same
    dispatch style as the existing `worktree autoland`/`worktree place`
    branches — no circular-require concern here since this is a pure read/write
    of a JSON file, no call back into another `lib/*` module that itself
    requires `ai-flow.js`).
  - `bin/lib/status.js` — surface a `review` field per story, read from the
    story's own worktree path the same way `computeLandReady` (~line 47) already
    reads verify freshness from `worktreePath`, not `cwd`.
  - `skills/flow-review/SKILL.md` + `templates/.claude/skills/flow-review/SKILL.md`
    — add the capture call to the Output contract, after the Verdict/Findings
    markdown.
- **Search anchors**: `writeVerifyEvidence`/`entryFromRunFile`
  (harness.js/audit.js — extend the pattern, do not redefine it);
  `latestVerifyByStoryDir`/`isStale` (audit.js — `isStale`'s signature,
  `isStale(entry, currentToken)` with `entry.ok`/`entry.treeToken`, already
  generic enough to accept a review entry unchanged); `computeLandReady`
  (status.js — the existing per-worktree evidence-reading pattern to mirror
  for the new `review` field).
- **Areas to avoid**: `verifyStoryOnce`/`writeVerifyEvidence`'s own internals
  (harness.js) — review evidence is a parallel, independent kind of proof, not
  a variant of verify's; do not thread review data through verify's own
  functions or evidence shape.

## Technical Notes

- Evidence shape mirrors `verify`'s own (`generatedAt`, `story`, `ok`,
  `provenance.git.treeToken`) so the two evidence kinds are structurally
  consistent and both readable with the same freshness primitive
  (`isStale`). The added, review-specific fields (`verdict`, `dimensions`,
  `findingCounts`, `reviewer`) do not change `isStale`'s contract — it only
  ever reads `entry.ok`/`entry.treeToken`.
- `findingCounts` stores counts only (`{p0,p1,p2,p3}`), not the finding list
  itself: the full findings already live in the review's own markdown output
  (and, when relevant, the story's `## Result`) — duplicating them into a
  machine-read evidence file would make the file a second source of truth for
  content nothing needs to re-parse, only to gate on. Story-04-02 only ever
  needs `ok`/`treeToken`/`verdict`; a human reading `status` only needs the
  counts to judge severity at a glance.
- `dimensions` records what actually ran (quick/deep/skipped per dimension) —
  not for gating in this story, but so a later reader (a human, or story-04-04's
  own acceptance criteria) can tell a quick pass from a deep one without
  re-reading the markdown output, which this story does not persist.

## Decisions

- **A new, separate `review capture` command, not a flag on `verify`.**
  Review and verify answer different questions (does the code work vs. does
  the change hold up under judgment) and can disagree independently (a green
  verify with a failing review, or vice versa on a story exempted from a
  particular check) — folding them into one command/one evidence shape would
  make that disagreement inexpressible. Two small, parallel commands/readers
  cost less than one overloaded one, matching this project's own extraction
  precedent (`placement-store.js` split out of `worktree-plan.js` for the same
  single-responsibility reason).
- **`isStale` is reused unchanged, not reimplemented for review.** The
  question "does this proof still describe the current tree" does not change
  meaning based on what kind of proof it is; `isStale(entry, currentToken)`
  already asks exactly that from `entry.ok`/`entry.treeToken` alone. Writing a
  second version invites the two to drift (e.g., one gets a bugfix the other
  does not) for no behavioral gain.

## Test Plan

- `test/review-evidence.test.js` (new): `writeReviewEvidence` writes a
  well-formed file under `.coding-flow/runs/`; `latestReviewByStoryDir`
  resolves the latest by `generatedAt` across multiple captures for the same
  story; `isStale` (imported unchanged from `audit.js`) correctly reports
  fresh immediately after capture and stale after a real commit changes the
  tree token — reusing `identity.js`'s `currentTreeToken` the same way
  `worktree.test.js`'s own `writeVerify` fixture already does for verify.
- `test/cli.test.js` or a new `test/review-cli.test.js`: `ai-flow review
  capture --story <dir> --verdict pass|fail [...]` writes the expected file
  and exits 0; missing `--story`/`--verdict` fails loudly with an actionable
  message (mirroring `worktree autoland`'s own `--epic`/`--story` requirement
  check in `ai-flow.js`).
- `test/status.test.js` (existing file, extended): a story with fresh-pass /
  stale / fail / no review evidence reports the corresponding `review` field
  value in both text and `--json` output.

## Acceptance Traceability

| Criterion | Test |
|---|---|
| Capture writes `ok`/story/treeToken correctly | `test/review-evidence.test.js` — capture shape |
| Fresh read-back with no tree change | same file — freshness, fresh case |
| Stale after a real tree change | same file — freshness, stale case (`isStale` reused) |
| Fail verdict recorded and distinct from stale/none | same file — fail case |
| No evidence reports `none` | `test/status.test.js` — review field, none case |
| Latest-by-`generatedAt` wins across multiple captures | `test/review-evidence.test.js` — multi-capture resolution |

## Commands

```bash
npm test
```
