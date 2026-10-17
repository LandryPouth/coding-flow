# Story 07-01 — Tasks

- [x] `resolveDiffBase` with the five sources and the scope classification; unit tests on throwaway repos.
- [x] `worktree add` records `branch.<name>.codingFlowBase`.
- [x] Switch the five harness call sites + `next`'s unshipped-work check to the resolved merge-base (computed once).
- [x] `diffBase` in evidence; `--base` flag; reuse key.
- [ ] (not done — needs a fresh story worktree on bethl; left for the owner) Replay check on bethl (read-only): run `ai-flow verify --story epics/epic-32-geo/story-32-03-served-countries --json` from a fresh story worktree and compare changed-file count with the 508 recorded on 2026-10-15. Note the numbers here.
- [x] `npm test`; verify; CHANGELOG.

## Result

`bin/lib/diff-base.js` resolves the base once per command; `harness.js` reads it in all five places; `worktree add` records `branch.<name>.codingFlowBase`.

### Rollback Notes

`git revert`; the recorded git-config keys are inert without the code.

## Status: done
