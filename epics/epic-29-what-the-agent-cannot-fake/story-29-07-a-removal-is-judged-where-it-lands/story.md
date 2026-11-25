# Story 29-07 — A removal is judged where it lands

## Status: planned

Split from 29-04 at its review cap (series 2, round 4 — the last of the series).
29-04 judges `rm` of a modified file in the repository the path lands in (a linked
worktree removing `../locked/sub/c.txt` is refused), but three spellings of the same
removal still reach no repository and are allowed:

- **A glob in a directory part.** From a linked worktree, `rm ../?/src/a.js`,
  `rm ../[r]/src/a.js`, `rm $D/?/src/a.js` and `rm ../*/src/b.js` are allowed while
  `rm ../r/src/a.js` is refused: `onDisk` (`bin/lib/guard.js`, ~line 1262) stops at
  the first glob component, `repoOf` finds no repository on the lexical path, and the
  word is skipped (`continue` → `applies: false`).
- **`..` after a symlinked directory.** `rm linkdir/../sub0/s.txt`, where `linkdir`
  links into another repository, is allowed: `..` is resolved as text
  (`bin/lib/destructive.js`, ~line 690), not on disk as the kernel does.
- **A nested repository.** A modified file in a nested repository that is not a
  submodule (`rm nested/n.txt`) is allowed; inside a submodule, `rm sm/*.txt` is
  refused but `rm sm/s.txt` is allowed (`indexHolds` answers from the outer index).

*(STRICT — guard. Added 2026-11-25.)*

**Implementation Context**:

- Never skip a word silently: a removal the guard cannot place is **unchecked**, never
  allowed.
- Globs in a directory part are expanded on disk as bash would, bounded (a cap on
  matches and on directories read, then unchecked), and each match is judged in its
  own repository (one `git status` per repository).
- `..` is resolved on disk, component by component, after each symlink.
- The repository of a path is the nearest `.git` on its real path (nested repositories
  and submodules included), not the cwd's.
- Do not edit 29-03's frozen side (hash-pinned reader, shell reader, judge).
- Files: `bin/lib/guard.js`, `bin/lib/destructive.js` (29-04's side),
  `test/guard-evasion.test.js` (or a new test file), `docs/rules-and-limits.md` (the
  row "`rm` into another repository where the guard cannot place the file").

## Acceptance Criteria

- [ ] Given a linked worktree beside a primary checkout `r/` whose `src/a.js` and
      `src/b.js` are modified, when the guard decides `rm ../?/src/a.js`,
      `rm ../[r]/src/a.js`, `rm $D/?/src/a.js` (`$D` the parent, absolute) and
      `rm ../*/src/b.js`, then each is denied, as `rm ../r/src/a.js` is.
- [ ] Given a glob in a directory part whose expansion passes the bound, when the
      guard decides it, then it is unchecked (never allowed), and the answer names
      the bound.
- [ ] Given `linkdir` a symlink to a directory of another repository whose
      `sub0/s.txt` is modified, when the guard decides `rm linkdir/../sub0/s.txt`,
      then it is denied.
- [ ] Given a nested repository `nested/` (not a submodule) with `n.txt` modified,
      when the guard decides `rm nested/n.txt`, then it is denied.
- [ ] Given a submodule `sm/` with `s.txt` modified, when the guard decides
      `rm sm/s.txt`, then it is denied, as `rm sm/*.txt` already is.
- [ ] Given the 43-command everyday corpus (Lens B), when the guard decides each
      command, then no command is newly denied or unchecked.
- [ ] Given `docs/rules-and-limits.md`, then the row on removals the guard cannot
      place is removed or states only what is still not judged.

## Commands

```bash
npm test
```

## Result
