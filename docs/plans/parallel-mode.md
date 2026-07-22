# Parallel mode — `ai-flow worktree`

This document describes the **optional** Git worktree support added to the
`ai-flow` CLI, to develop several features in parallel (one directory per branch)
without leaving the project's zero-dependency stance.

To understand worktrees and the *bare* layout in depth (concept, pitfalls,
converting an existing repo), see `docs/git-worktree-bare.md`.

## Why it's opt-in, and not in `init`

The worktree acts on the **Git repository**, not on the coding-flow methodology.
Making it mandatory would distort the tool and impose a heavy layout on everyone,
whereas most epics are **sequential**. So:

- `init` stays a standard repository — no colleague or tool is surprised.
- The worktree is an **extra capability**, enabled on demand, on the features
  that are genuinely independent.

## Commands

| Command | Effect |
| --- | --- |
| `ai-flow worktree add <name> [--from <ref>] [--deps install\|link\|skip] [--story <dir>] [--dry-run]` | Creates the worktree + branch, wires `.env` and dependencies |
| `ai-flow worktree list` | Lists the worktrees, their branch, and the state of the `.env` links |
| `ai-flow worktree remove <name> [--force] [--dry-run]` | Removes the worktree, **keeps the branch** |

### `add`

- **Grouped** location: `../<repo>-worktrees/<name>` (keeps the parent directory
  clean instead of scattering siblings).
- Creates the `<name>` branch from `HEAD` (or `--from <ref>`). If the branch
  already exists, it is reused.
- Symlinks `.env` / `.env.local` if they exist at the root (no copy).
- Handles `node_modules` per the **dependency strategy** (below).
- `--dry-run` prints the plan without writing anything.

### Worktree ↔ story link (`--story`)

- `add --story epics/<epic>/story-<nn>-<mm>-<slug>` names the branch/worktree
  after the **story directory** instead of an arbitrary name.
- The mapping is **stateless**: `ai-flow status` links a story to its worktree
  when the branch name equals the story directory name. No mapping file to
  maintain, nothing to resync.
- `--story` validates that the directory exists in the repo and suggests the
  matching `harness preflight --story <dir>`, which closes the loop worktree →
  story → harness.
- A `<name>` + `--story` conflict with different names ⇒ explicit error (you
  pick one or the other).

`ai-flow status` now shows, in addition to the epics/stories, the worktree linked
to each story (`→ wt: ...`) and a "Worktrees (not linked to a story)" section for
loose branches: a dashboard of the parallel work in progress. In JSON, the
`worktrees` block exposes `active` (inside a git repo or not) and `loose`.

### `remove`

- `git worktree remove` **keeps the branch**: no commit is lost. The only real
  risk is **uncommitted** work.
- It therefore refuses if the working tree is dirty, **except with `--force`**.
  Our own links (`.env`, `node_modules`) are excluded from this check and removed
  before deletion, so they don't block it needlessly.
- Runs `git worktree prune` behind it (the classic pitfall from the article).
- Reminds how to delete the branch (`git branch -D <name>`) if wanted.

### Why siblings and not a `worktrees/` inside the repo

Putting the worktrees in a `worktrees/` directory *inside* the repo (even
gitignored) looks cleaner but breaks in practice: `.gitignore` only hides a
directory from **git**, not from `tsc`/eslint/jest, watchers, `docker build .`,
or workspace globs (`packages/*`, `apps/*`, `**`) — which would then traverse N
copies of the code. And `git clean -fdx` would delete the directory along with
all uncommitted work. The `../<repo>-worktrees/` sibling is out of reach of all
these tools. The intended `feat/`/`fix/` categorization stays free via the
branch name (`add feat/x` → `../repo-worktrees/feat/x`, thanks to `path.join`).

## `ship` — one feature, one PR

`ai-flow ship` pushes the **current branch** and opens/updates **one** PR against
the base. The decision keys off the branch, never the local layout: a push only
carries commits, so the remote repo stays normal no matter what (there is nothing
to "detect"). Explicit (a command), never a pre-push hook — opening a PR is an
outward side effect that has no business in a hook (duplicates, CI failures,
blocked push).

| Step | Behavior |
| --- | --- |
| Guardrails | refuses if HEAD is detached, if on the base, without an `origin` remote, or without a commit above the base |
| Push | `git push -u origin <branch>` |
| PR (GitHub + `gh`) | creates the PR if absent, otherwise the push already updated it (idempotent) |
| PR (GitHub without `gh`) | prints the compare URL to open by hand |
| Non-GitHub remote | pushes and stops (no PR) |

Options: `--base <ref>`, `--title <text>`, `--draft`, `--web`, `--dry-run`.
`gh` is an **optional** dependency (like `git` is required): without it, the
command degrades cleanly.

## Dependency strategy

Symlinking `node_modules` is safe for a simple project but **breaks a pnpm/yarn
monorepo** (the `.pnpm` virtual store is tied to the workspace root). The CLI
detects the context and chooses:

| Detected context | Default | Reason |
| --- | --- | --- |
| pnpm, yarn, or workspace | recommends `install` (does not run it) | symlink dangerous |
| plain npm with `node_modules` present | `link` (symlink) | fast and safe |
| no `node_modules` | recommends `install` | nothing to link |

Manual override: `--deps install` (runs the package manager in the worktree),
`--deps link` (forces the symlink), `--deps skip` (does not touch the deps).

`.env` / `.env.local` are **always** symlinked: small, unversioned, we want the
same secrets everywhere.

## Files added

| File | Role |
| --- | --- |
| `bin/lib/worktree.js` | Implementation (zero-dep, shell-out to `git`) + non-fatal `collectWorktrees` + `--story` |
| `bin/lib/status.js` | Reads the worktrees and links each story to its branch |
| `bin/lib/ship.js` | `ship`: push of the current branch + PR (via optional `gh`) |
| `bin/ai-flow.js` | Dispatcher wiring + help |
| `test/worktree.test.js` | 8 contract tests (real git repo in temp) |
| `test/status.test.js` | 5 tests of the worktree ↔ story link |
| `test/ship.test.js` | 6 tests (local bare remote, guardrails + real push) |

The module lives under `bin/` to stay in the `files` field of `package.json`, so
it is shipped by `npx`. `test/` is not: the tests protect development without
bloating the install.

## Tests

Behavioral: we set up a real throwaway git repo, run the CLI, and verify what is
observable (directories, symlinks, kept branches, exit codes).

- `add` creates the directory + a new checked-out branch;
- `add` symlinks `.env` present at the root;
- `add --deps link` symlinks `node_modules`;
- `add --dry-run` writes nothing;
- `list` shows the added worktree;
- `remove` removes the worktree but **keeps the branch**;
- `remove` succeeds despite our own `.env` symlinks (regression);
- `remove` refuses a dirty worktree without `--force`.

```bash
npm test
```

## What is deliberately out of scope

- **The conversion to the `.bare` layout** is not automated. It is the most
  invasive move (it relocates the code from `repo/` to `repo/main/` and breaks
  paths/docker/IDE), and it is O(1) on demand. It is documented in the general
  reference, to be done manually when the need is real.

## Possible next steps

- `ai-flow worktree convert` (explicit opt-in, heavily guarded) for the bare layout.
- Make the list of shared files configurable via `.coding-flow/`.
- Tested Windows support (junctions already handled for directories).
