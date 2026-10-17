# Story 10-01 — Tasks

- [x] Scope computation (story dir, diff scope, sibling untracked, story runs).
- [x] Stage list / left-out list; `--all`; worktree default.
- [x] Secret scan on staged set.
- [x] Tests; `npm test`; verify; CHANGELOG; README `ship` paragraph.

## Status: done

## Result

- `ship` stages the story's scope by default (`--all`, story worktree and unlinked branch keep the whole tree); secret scan runs on the committed files only.
- Verify green (`Coverage: evidence`). Independent review found staged deletion/rename, nested-repo, root-dir, literal-pathspec issues — fixed and tested. Not changed: any linked worktree counts as a "story worktree".
