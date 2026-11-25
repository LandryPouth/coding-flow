# Story 34-02 — `next` answers in seconds

## Status: in-progress

## User Value

On a repository with ~190 stories (bethl), `ai-flow next` answers in a few
seconds instead of minutes, so the maintainer and the agents actually use it.

## Implementation Context

- Measured 2026-11-25: `ai-flow next` on bethl did not answer within 110 s;
  31-04's dry runs put the status model at ~80 s, almost all in per-story
  `currentTreeToken`-style git reads. A CPU profile of `next` on bethl is the
  first task (`node --cpu-prof`), recorded in the Result with the top frames.
- **Profile taken 2026-11-25 on bethl (46 epics, 214 stories): `next` took
  3 min 28 s.** 182 s of self time is `spawnSync` (git). Inclusive:
  `buildQueue` 204 s → `buildStatusModel` 145 s (per story, status.js:257-259)
  → `currentTreeToken`/`computeTreeToken` 92 s (identity.js:151-182) →
  `workingTreeTree` 80 s (identity.js:109); `proofOf`/`storyProof` (next.js:62,
  164) 58 s, recomputing the same; `computeReviewStatus` 39 s. The tree token
  of one checkout cannot change during one run, yet it is recomputed per
  story: memoising it per (cwd, run) is the first, likely decisive, step;
  then make `storyProof` reuse the status model instead of a second pass.
- Likely files: `bin/lib/status.js` (`buildStatusModel`), `bin/lib/identity.js`,
  `bin/lib/evidence.js`, `bin/lib/next.js`. Likely fix: compute repository-wide
  git facts once per run (one `git ls-files -s`/`git status` and one `git log`
  pass) and share them across stories instead of spawning git per story; no
  persistent cache file unless the profile proves it is needed (design
  decisions refuse a daemon).
- Execution mode STANDARD. Scout: yes (profile first). Avoid: changing what any
  state means — only how fast it is computed.

## Acceptance Criteria

- [x] Given a read-only clone of bethl, when `ai-flow next` runs, then it
      answers in under 5 s on the maintainer's machine (time recorded in the
      Result, before and after, with the profile's top frames).
- [x] Given the same clone, when `ai-flow status --json` and `ai-flow next
      --all --json` run before and after the change, then their outputs are
      identical (diffed in a test fixture or recorded in the Result).
- [x] Given a generated repository with 200 stories in a throwaway directory,
      when `next` runs, then the number of git processes it spawns does not
      grow with the number of stories (asserted by counting spawns through a
      test hook or a wrapped `git` on PATH).
- [x] Given this repository, when `npm test` runs, then every existing status,
      next and archive test passes unchanged.

## Commands

```bash
npm test
```

## Result

Measured on a read-only `git clone --no-hardlinks` of bethl at `97437575`
(46 epics, 214 stories, 1 048 run files / 20 MB, no linked worktree), on the
maintainer's machine, from the HEAD tree (`git archive`) vs this change.

| `ai-flow next` | before | after |
|---|---|---|
| wall time (`/usr/bin/time`) | 124.3 s | 2.50 s, 2.67 s, 3.04 s (then 2.72 / 2.47 / 2.89 s once the to-do scan shares the memo) |
| CPU profile total | 90.5 s | 2.16 s |
| git spawns, generated repo 20 / 200 stories (test) | 141 / 1 131 | 28 / 28 |

Top frames before (`node --cpu-prof`, inclusive): `buildQueue` 88.4 s →
`currentTreeToken`/`computeTreeToken` 76.9 s (→ `workingTreeTree` 59.9 s),
`buildStatusModel` 57.9 s, `proofOf`/`storyProof` 30.0 s,
`computeReviewStatus` 18.4 s; self time `spawnSync` 75.9 s.

Top frames after: `next` 1.81 s → `buildStatusModel` 1.18 s, of which reading
the run files once (`collectAll`/`entryFromRunFile`) is most of the rest; the
to-do scan (`collectNeedsYou`) ~0.5 s; self time `spawnSync` 0.39 s (the git
calls left are per checkout, not per story). Module loading is ~0.5 s.

What changed: `bin/lib/read-memo.js` (`withReadMemo`, `remember`) holds, for one
synchronous read, the facts of a checkout keyed by its resolved path: the tree
token (`identity.currentTreeToken`), the current branch (`policy.currentBranch`),
the policy fingerprint, and the latest verify/review per story dir
(`audit.latestVerifyByStoryDir`/`latestReviewByStoryDir`). Outside a memo,
`remember` computes every time, so verify, land, worktree, archive, claim,
coverage and `todo done` behave exactly as before. Only `buildStatusModel` and
`next` (queue + to-do scan) open the memo; it is dropped when they return, so
`archive` — which builds the model then writes — writes after the memo is gone.
`storyProof`/`proofOf` now hit the same memo as the status model instead of a
second pass of git. No file, no daemon.

Identical output: `status --json` (116 820 bytes), `next --all --json`
(90 577 bytes), `next` text and both stderr streams were byte-identical
before/after (`cmp`, no masking needed); the clone stayed clean.

Spawn test: `test/next-spawns.test.js` puts a counting `git` wrapper first on
PATH and runs `next --all --json` on generated repositories of 20 and 200
stories; it failed on HEAD (`141 for 20, 1131 for 200`) and passes now (28/28).
`test/layering.test.js` lists `read-memo` as core (identity and audit use it).


Verify (one run, `.coding-flow/runs/2026-11-25T21-56-33-108Z-verify.json`):
red, 2134 pass / 1 fail — `test/security-core-risk.test.js` asks every module a
high-risk module requires to be high-risk itself, and `read-memo.js` (required
by `identity.js` and `audit.js`) was not. Fixed by adding it to this
repository's `highRiskPaths` (it decides which tree token a proof is judged
against); that test and `weakened-tests.test.js` pass since (70 pass, the
known 19-08 TODO). Not re-verified: the npm-test criterion stays open until the
next verify. Adding the path changes this repository's policy fingerprint, so
its earlier proofs read "policy changed".

## Policy Change

Tightened, not loosened: `.coding-flow/harness.json` adds `bin/lib/read-memo.js` to the high-risk paths, because `identity.js`, `audit.js`, `policy.js` and `policy-fingerprint.js` (all high-risk) now require it and it decides which tree token a proof is judged against (`test/security-core-risk.test.js` asks every module a high-risk module requires to be high-risk itself). Earlier proofs of this repository now read "policy changed".

## Review findings

### Round 1 — FAIL (staleness and correctness of the memo)

- [x] P1 story.md — `.coding-flow/harness.json` gains `bin/lib/read-memo.js` in `highRiskPaths` (policy-changed signal) without a `## Policy Change` section (what coverage-gate.js:905 reads; 29-04 did it in bb6e8cb) — fix: add the section: read-memo.js joins highRiskPaths because identity/audit require it (test/security-core-risk); earlier proofs now read "policy changed".
- [x] P1 (orchestrator, from the verify at 26a12d1: `.coding-flow/runs/2026-11-25T22-08-55-735Z-verify.json`) — NOT PROVEN, functionSize.enforce: `bin/lib/next.js:165 readQueue` 0→89 lines, `bin/lib/status.js:255 readStatusModel` 0→91 lines — fix: split each under 80 lines, no behaviour change (byte-identical outputs still).
- [x] P2 `test/next-spawns.test.js` builds repos with no linked worktree and no review evidence: a new per-story spawn on the worktree path (`next.js:170` proofOf with story.worktree) or the review path would pass — add both to the generated repo.

Held: only next, status and archive.plan open the memo, none writes inside it; no long-lived loop; finally drops it on throw; nested reuse correct; keys path.resolve(root) (+ version for the fingerprint); byte-identical on a fresh bethl clone, a clone with a linked worktree + verify + dirty/untracked files from the primary and from the worktree (2–3 s vs 43–154 s); spawn test fails on the old code.

Fixes (round 1):

- P1 policy: `## Policy Change` added (read-memo.js joins the high-risk paths,
  tightened; earlier proofs read "policy changed").
- P1 function size: `readQueue` now ranks each story through `storyItem` (one
  item or none, same tiers in the same order); `readStatusModel` maps each
  story through `storyModel`, whose stale reason and written-`done`
  contradiction moved to `proofVerdicts`. Same calls in the same order. On two
  fresh `git clone --no-hardlinks` of bethl at `70b8b3b1` — one plain, one with
  a linked worktree on `story-45-01-…` and a dirty README — `status --json`,
  `next --all --json` and `next` (stdout and stderr, exit 0) are byte-identical
  (`cmp`) between the round-1 commit (`git archive 423e581`) and this change.
- P2 spawn test: the generated repositories now have a captured review on every
  fourth story (half pinned to an old tree token, some failing) and the second
  to last story, a done one, in a linked worktree whose own last verify is red;
  the test asserts that story is ranked tier 3 with `cd ../repo-N-wt && ai-flow
  verify`. Spawns: 47 for 20 stories, 47 for 200. Caught in a throwaway copy,
  and missed by the round-1 test: a git call per story with a review
  (`computeReviewStatus` running `git write-tree`: 52 → 97) and a git call per
  story to each linked worktree in `proofOf` (67 → 247). The pre-34-02 code
  (`b312ab7`) still fails it (181 → 1 396).

Verify (round 1 fixes, `.coding-flow/runs/2026-11-25T22-21-08-440Z-verify.json`):
green, 3/3 commands (the whole suite included), coverage 97.1% of 240 added
lines; warnings only: the then-open npm-test criterion (ticked now: the suite
passed unchanged) and "policy changed: .coding-flow/harness.json" (declared
above).

### Round 2 — PASS (the refactor and the claims, on this repository)

- [x] P2 story.md Policy Change named only identity.js and audit.js; policy.js and policy-fingerprint.js require read-memo.js too — fixed by the orchestrator.
- P2 noted: `archive --stories` is not in this build (it lands with 31-04); `archive <epic> --dry-run`, `--json` and `--refresh --dry-run` were compared instead.

Held: the split hides no logic change; byte-identical `status --json`, `next --all --json`, `next` vs develop's bin on this repository (primary 1.6/1.4/1.3 s vs 2.9/4.7/6.7 s; worktree 0.7/0.8/0.9 vs 0.9/1.2/1.3 s); archive dry-runs and `doctor` identical (1.2 s vs 2.3 s); Policy Change read by verify, no "undeclared"; function size ok; criteria hold.
