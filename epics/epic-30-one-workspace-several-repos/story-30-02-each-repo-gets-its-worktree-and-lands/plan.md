# Plan — 30-02 Each repository gets its worktree and lands

## Implementation Context

- Mode: STRICT (merges into base branches; partial failure). Scout: yes.
- Likely files: `bin/lib/worktree.js` (`requireRepo` callers at `:230`,
  `:371`, `:410`, `:465`, `:523`, `:550`, `:867`: take a repository root
  argument instead of resolving the project root), `bin/lib/worktree-plan.js`
  (`requireProjectRootIsGitRoot` `:80`, `decidePlacement`),
  `bin/lib/placement-store.js`, `bin/lib/workspace.js` (from 30-01),
  `bin/lib/evidence.js` (worktree-aware repo path), README worktree section,
  `docs/git-worktree-bare.md`.
- Avoid: running any rollback; stash; changing behaviour for single-repo
  projects.

## Technical notes

- Introduce `forEachStoryRepo(workspace, story, fn)` in `workspace.js`
  returning per-repo results; worktree commands become loops over it.
- Preflight = pure function over per-repo facts (clean, merge-tree result,
  evidence freshness) → testable without merging.
- Use `git merge-tree --write-tree` (git ≥ 2.38) for the conflict check;
  fall back to "unknown, refuse" when unavailable.

## Decisions

- Assumption (unconfirmed): no automatic rollback after a partial land; the
  human runs the printed command (destructive commands wait for the human,
  epic 29-03).

## Test plan

- Fixture workspace with two repos and bases; cases = acceptance criteria;
  a conflict built by committing on base after branching; a failure injected
  after the first merge (hook that exits 1 in the second repository).

## Acceptance Traceability

_(to fill)_

## Commands

```bash
npm test
```
