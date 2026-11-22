# Story 30-06 — A workspace is installed in one command

## User Value

In a folder like `~/dev/sabytoo/tse-binam/`, `ai-flow init --workspace`
finds the git repositories nested one level down, writes `.coding-flow/` and
the `repos` map, keeps those repositories out of the workspace's own git, and
prints what it did — so the maintainer can install tse-binam without editing
JSON by hand.

## Requirements

- Detect direct child folders that are git repositories (`.git` dir or file).
  Each becomes `repos.<folder>` with `path`, `base` (from its default branch
  resolution: `develop` when present, as `diff-base.js` does), and its
  detected validation commands shown for confirmation (not written unless
  `--write-commands`).
- When the workspace is a git repository: append the repository folders to its
  `.gitignore` (idempotent). When it is not: offer `--git-init` (off by
  default) to create one for epics and docs; never required.
- Installs the skills and guard once, at the workspace root (today's `init`
  steps), and never inside a repository.
- `--dry-run` prints everything and writes nothing; an existing `repos` key is
  never overwritten without `--force` (AGENTS.md: idempotent and
  non-destructive).
- Refuses when a child repository already holds `.coding-flow/` (epic
  decision), naming it.

## Acceptance Criteria

- [ ] Given a folder with `api/` and `web/` git repositories and no `.coding-flow/`, when `ai-flow init --workspace` runs, then `.coding-flow/config.json` holds `repos.api` and `repos.web` with their paths and bases, and nothing is written inside `api/` or `web/`.
- [ ] Given the workspace is a git repository, then its `.gitignore` gains `api/` and `web/` once, even after a second run.
- [ ] Given `--dry-run`, then no file changes and the planned config is printed.
- [ ] Given an existing `repos` key, when init runs without `--force`, then it is unchanged and the output says so.
- [ ] Given `web/.coding-flow/` exists, when init runs, then it exits non-zero naming `web`.
- [ ] Given no nested repository, when `init --workspace` runs, then it exits 2 with a message, and plain `init` is unchanged.

## Edge Cases

- A child folder that is a git worktree (`.git` file pointing elsewhere): not
  a repository of the workspace; skipped with a note.
- Hidden folders and `node_modules`: skipped.
