# Story 05-01 — Resolve paths the way the filesystem will

## User Value

A protected file stays protected whatever name, link or directory the write
reaches it through. Today a symlink, an absolute path into the primary
checkout, or a session opened in a subdirectory each bypass the policy.

## Requirements

- **Project root.** `decide(hook, root)` evaluates against the project root:
  the nearest ancestor of the hook `cwd` containing `.coding-flow/`, else
  `git rev-parse --show-toplevel`, else the hook `cwd` (today's behaviour).
  Policy (`harness.json`) is loaded from that root.
- **Real path.** For each target, compute:
  - the lexical path (today: `path.resolve(root, target)`);
  - the real path: `fs.realpathSync` of the target when it exists, otherwise
    `realpath` of its nearest existing ancestor joined with the remaining
    segments.
  Both are checked; a hit on either denies, and the reason names both when
  they differ (`alias → .env`).
- **Outside the root.** A path (lexical or real) outside the project root is
  matched, in order, against:
  1. the **primary checkout** root when the project is a git worktree
     (`git rev-parse --git-common-dir` → its parent), so a worktree's `.env`
     symlink target and an absolute path to the primary `.env` are both
     `.env`;
  2. `$HOME`, so `.ssh/**` and `**/id_rsa` patterns apply to
     `~/.ssh/authorized_keys`.
  A path outside all three is allowed as today (no pattern can be relative to
  it).
- **`~` expansion.** In shell targets, a leading `~/` or `$HOME/` (and
  `${HOME}/`) expands to the home directory before resolution.
- Pure and fast: no spawn per decision except the git calls needed for the
  root, cached per process (the OpenCode plugin keeps the module loaded).

## Acceptance Criteria

- [x] Given `alias -> .env` in the project, when Write targets `alias`, then
      deny, and the reason names `alias` and `.env`.
- [x] Given the same link, when Bash runs `echo A=1 > alias`, then deny.
- [x] Given a git worktree whose `.env` links to the primary checkout's
      `.env`, when Write targets the primary `.env` by absolute path from the
      worktree, then deny; when Write targets the worktree's `.env`, then deny.
- [x] Given a session cwd `apps/api` inside a repo with `.coding-flow/` at the
      top, when Write targets `../../.env`, then deny.
- [x] Given `echo k >> ~/.ssh/authorized_keys`, then deny (`.ssh/**`).
- [x] Given a new file `src/new.js` (does not exist yet, parent exists), then
      allow — the nearest-ancestor resolution must not fail on non-existent
      targets.
- [x] Given a case-insensitive filesystem (`win32`, default `darwin`), when
      Write targets `.ENV`, then deny — today it is allowed (found by the
      06-01 STRICT review).
- [x] Given a link whose real path is `/tmp/elsewhere/file.txt`, then allow.
- [x] Given `node_modules` itself being a symlink (pnpm, worktree deps link),
      when Write targets `src/a.js`, then allow; when Edit targets a file
      under `node_modules/…`, then deny (lexical hit) — unchanged from today.

## Edge Cases

- **Loops / broken links**: `realpath` throwing (ELOOP, dangling link) → fall
  back to the lexical path and record the reason; never throw (05-02 turns
  this into `unchecked`).
- **Windows**: `realpathSync.native` and case-insensitive comparison on
  `win32`; `normalizePortable` on every compared path.
- **Performance**: the plugin calls `evaluate` per tool call; root and
  common-dir lookups are memoised per root.

## Status: done

## Result

Guard resolves lexical + real paths (dangling links followed), the outermost
`.coding-flow/` within the git toplevel, the primary checkout of a linked
worktree, `$HOME`, and `~`/`$HOME` in shell targets. Independent STRICT review
found a dangling-link bypass and a nested-`.coding-flow` policy swap; both fixed
and tested. Known limits left for 05-03/05-05: a link created in the same command,
`$PWD`/`cd` forms, case-insensitive mounts on Linux (WSL `/mnt/c`).

A second review (2026-10-17) found the toplevel bound compared a resolved git
path with a lexical cwd (symlinked cwd, Windows `C:/…`), letting an outer
`.coding-flow/` become the root; the heuristic secret allowlist judged only the
name given; a git timeout was memoised as "no repo". All three fixed and tested.

A third review (2026-10-17) found a link's `..` collapsed lexically under a
symlinked directory (`a -> sub/deep`, `a/x -> ../../.env` judged outside the
root, in `realPathOf` and in the `ln` alias check), and a git timeout silently
dropping the repository bound for that call. Both fixed and tested; the timeout
now makes the decision `unchecked`.

### Rollback Notes

`git revert` the commit; no data or config migration.
