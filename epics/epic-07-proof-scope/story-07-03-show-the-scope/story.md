# Story 07-03 — Show the scope

Once 07-01 records `diffBase`, the people reading a verdict see it: a
coverage line that says "82 test files" means something very different with
"scope: epic, base: main" than with "scope: story, base:
feature/EPIC-32-geo".

*(QUICK — output lines only.)*

## Acceptance Criteria

- [x] `ai-flow verify` text output prints
      `Scope: story — diff against feature/EPIC-32-geo (fork point), 12 files`.
- [x] `ai-flow status` shows the scope next to the coverage state when it is
      not `story` (`coverage ok (epic scope)`).
- [x] `ai-flow ship` PR body's evidence section includes the scope line.
- [x] `ai-flow doctor` warns when `refs/remotes/origin/HEAD` is missing and a
      remote exists: `run \`git remote set-head origin -a\``. (bethl has no
      `origin/HEAD`; the default base silently became the literal `"main"`.)
- [x] `npm test` green.

## Result

`describeScope` (diff-base.js) words the line once for `verify`, `ship` and `status`; `doctor` gains `origin_head_missing`. Rollback: `git revert`.

## Status: done
