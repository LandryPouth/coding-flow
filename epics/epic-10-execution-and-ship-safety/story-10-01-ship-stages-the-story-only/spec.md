# Story 10-01 — `ship` stages the story, not the whole tree

## User Value

Shipping a story from a checkout with other work in progress does not smuggle
that work into the PR.

## Requirements

- `autoCommitDirtyTree` stages:
  - every dirty/untracked file inside the story directory
    (`epics/<epic>/<story>/`);
  - dirty files already in the story's diff scope (07-01's changed-file set,
    i.e. files the branch has touched since its base);
  - untracked files whose directory already contains a file of that scope;
  - `.coding-flow/runs/*` produced for this story (verify/evidence/review JSON
    whose `story` field is this story).
- Everything else stays unstaged and is listed: `Left out of the commit (not
  in this story's scope): …  Re-run with --all to include them.`
- `--all` keeps today's `git add -A`.
- In a story worktree (isolated by construction), the default is `--all`
  behaviour — there is nothing else in it.
- `--dry-run` prints the exact include/exclude lists.
- The quick secret scan runs on the staged set only (today: whole tree).

## Acceptance Criteria

- [x] Shared checkout, story touched `src/geo/a.ts`; dirty: `src/geo/a.ts`,
      `src/billing/b.ts`, new `src/geo/c.ts`, story `tasks.md` → commit holds
      `a.ts`, `c.ts`, `tasks.md`; `b.ts` listed as left out.
- [x] Same with `--all` → all four committed.
- [x] In a story worktree → all dirty files committed without `--all`.
- [x] `--dry-run` prints both lists, commits nothing.
- [x] A secret in a left-out file does not block the ship; a secret in a
      staged file still does.

## Edge Cases

- Deleted files in scope are staged as deletions (`git add -A -- <paths>`).
- No story linked to the branch → today's behaviour with a warning (cannot
  compute scope).
