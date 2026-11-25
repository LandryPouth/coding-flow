# Story 34-02 — `next` answers in seconds

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

- [ ] Given a read-only clone of bethl, when `ai-flow next` runs, then it
      answers in under 5 s on the maintainer's machine (time recorded in the
      Result, before and after, with the profile's top frames).
- [ ] Given the same clone, when `ai-flow status --json` and `ai-flow next
      --all --json` run before and after the change, then their outputs are
      identical (diffed in a test fixture or recorded in the Result).
- [ ] Given a generated repository with 200 stories in a throwaway directory,
      when `next` runs, then the number of git processes it spawns does not
      grow with the number of stories (asserted by counting spawns through a
      test hook or a wrapped `git` on PATH).
- [ ] Given this repository, when `npm test` runs, then every existing status,
      next and archive test passes unchanged.

## Commands

```bash
npm test
```

## Result
