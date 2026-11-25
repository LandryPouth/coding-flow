# Story 19-10 — The fixers test holds under load

## Status: in-progress

Risk: QUICK (one helper in `bin/lib/identity.js`, two tests). Owner: agent.

## Why

`test/harness-fixers.test.js` (story 19-05) failed about five times on
2026-11-24 during verifies and `npm test` on several branches, never the same
way twice, and passed when run alone. Each red verify cost a full rerun
(4–11 minutes under load) and made every land look flaky. The missing file
was always a story file whose fixer edit keeps the size (`- [ ] done` →
`- [x] done`).

## Cause (found, with evidence)

A code bug, not a test bug. `workingTreeSnapshot` (and the tree token's
`workingTreeTree`) copy the real index to a throwaway file and run
`git add -A` against it. Git trusts an index entry whose size and mtime match
the file unless the file is as new as the index itself — the "racily clean"
case, which it re-reads. `copyFileSync` stamps the copy with the time of the
copy. When the commit, the snapshot before the fixers and a same-size fixer
rewrite all fall in one second and the second snapshot's copy is taken in the
next second, git trusts the stale entry and the rewrite is unseen:
`fixedFiles` lacks the story file, and the "a fixer changed the story's
files" red is lost. Under load the second boundary falls in that window more
often — hence "flaky under load".

Reproduced with fixed timestamps (`core.trustctime=false`, file, entry and
index at one mtime, same-size rewrite at that mtime): `git status` showed
`M f.md`, the snapshot diff showed `[]`.

Real-world effect beyond the test: a formatter that rewrites a story file at
the same size within the second of a commit escaped the story-file guard of
19-05, and a same-size edit made within the second of the index could leave
the proof's tree token unchanged (a stale proof read as current).

## Fix

`copyIndex` copies the index and gives the copy the real index's mtime in
whole seconds, floored, so git applies at least the racy-clean re-reads it
applies to the real index. Both throwaway-index paths use it. Passing the stat
`Date` instead (round 1) rounded .9995 s and above up into the next second,
which reopened the window (found by the round-1 review); flooring can only
make the copy earlier, which only makes more entries re-read.

## Acceptance Criteria

- [x] A story file a fixer rewrites at the same size and mtime, within the
  second of the commit, is listed in `fixedFiles`.
- [x] The tree token moves on a same-size edit made within the second of the
  index (the throwaway-index path, with an untracked file around).
- [x] The copy is never later than the real index, even when the index's
  mtime is in the last half-millisecond of a second.
- [x] No test was weakened: the flaky tests keep their assertions.

## Acceptance Traceability

1. test/harness-fixers.test.js::a story file a fixer rewrites within the second of the commit is still listed
2. test/harness-fixers.test.js::the tree token moves on a same-size edit made within the second of the index
3. test/harness-fixers.test.js::the tree token moves when the index was written in the last half-millisecond of the second
4. test/harness-fixers.test.js::a tracked story file a fixer edits is listed, with no untracked file around

## Result

Both new tests fail without the fix and pass with it (deterministic, fixed
timestamps). The intermittent tests share the cause; see the repro numbers in
the commit and the report.
