# Story 07-01 — Resolve the story's diff base

## User Value

"This story is covered" and "this story is high risk" are statements about
the story, not about the whole epic plus everything not yet merged to `main`.

## Requirements

- New `resolveDiffBase(root, { story, flagBase })` (in `bin/lib/policy.js`
  next to `defaultBranch`, or a new `bin/lib/diff-base.js`) returning
  `{ ref, mergeBase, source, scope }`:
  - `source` ∈ `flag | config | fork-point | nearest | default | none`;
  - `scope` ∈ `story` (HEAD's branch is a story branch, i.e. matches a
    `story-*` directory name or has a recorded fork point), `epic` (HEAD is an
    epic/feature branch), `branch` (anything else), `working-tree` (no
    merge-base found).
- Source order exactly as in the epic's Decisions.
- `worktree add` with `--from <ref>` (and every internal caller that creates a
  story worktree: `place`, `autoland` chains) runs
  `git config branch.<name>.codingFlowBase <ref>` after creating the branch.
  Without `--from`, it records the branch checked out in the primary checkout
  at that moment.
- The five `defaultBranch` call sites in `harness.js` and the diff risk in
  `worktree-plan.js` use the resolved `mergeBase` (computed once per verify
  and passed down — not re-resolved in each function).
- `verify`, `evidence` and `harness check` evidence JSON gain
  `diffBase: { ref, mergeBase, source, scope }`.
- `verify --base <ref>` and `harness check --base <ref>`.

## Acceptance Criteria

- [ ] Given `main` ← `feature/EPIC-07-x` (10 files changed) ← story branch
      created by `worktree add --from feature/EPIC-07-x` (2 files changed),
      when verify runs in the story worktree, then `coverage.changedFiles` has
      2 entries and `diffBase` is `{ ref: "feature/EPIC-07-x", source:
      "fork-point", scope: "story" }`.
- [ ] Same repo, story branch created by plain `git switch -c` from the epic
      branch (no recorded fork point): `source: "nearest"`, same 2 files.
- [ ] Given `config.json` `baseBranch: "develop"`, then `source: "config"` and
      the merge-base with `develop` is used.
- [ ] Given `verify --base main`, then `source: "flag"`.
- [ ] Given verify on the epic branch itself, then `scope: "epic"` and the
      diff is the epic against its nearest base (not against itself).
- [ ] Given no remote and no `main` (fresh repo on `trunk`), then
      `source: "none"`, `scope: "working-tree"`, and coverage behaves as today
      outside a base.
- [ ] Risk: a story touching only `src/geo/*.ts` on an epic whose other
      stories touched `prisma/migrations/*` scores from its own files (not
      `high` because of the migrations).
- [ ] `scanTestWeakening` and `deletedFilesInDiff` only report files from the
      story's diff.

## Edge Cases

- **Rebased story branch**: the recorded ref is a branch name, not a SHA; the
  merge-base is recomputed each time, so a rebase onto the moved epic branch
  keeps working.
- **Recorded ref deleted** (epic merged and removed): fall through to
  `nearest`, record that the fork point was missing.
- **Performance**: `nearest` costs one `merge-base` + one `rev-list --count`
  per candidate (≤ 4); acceptable once per verify.
- **Reuse**: `findReusableVerify` must not reuse a verify computed with a
  different base — include `diffBase.mergeBase` in the reuse key.
