# Git worktree & bare clone

> Work on several branches in parallel, in separate directories that share a single Git history

This reference reuses and **enriches** the excellent article by Metal3d,
*"Git worktree like a boss"* (dev.to), so as not to depend on its survival
online. It adds what the article does not cover: converting an existing repo,
sharing `node_modules`/`.env` between worktrees, the pnpm monorepo pitfall, and
**when NOT to use worktrees**.

## When to use it

As soon as you need to have **several branches open at the same time**, each in
its own working directory:

- an urgent hotfix while you are in the middle of a big feature;
- running a long test suite in one directory while you code in another;
- running **several AI agents in parallel**, one per feature, without them
  stepping on each other.

Do **not** use it for sequential/dependent work (see the final section).

## The concept in one sentence

A *worktree* = an additional working directory attached to the **same** Git repo.
Instead of a single checkout at a time, you have several branches checked out
simultaneously in different directories, sharing **one** `.git` (history,
objects, hooks, config). Introduced in Git 2.5.

### Worktree vs branch vs clone

| | Branch | Worktree | Multiple clones |
|---|---|---|---|
| Files isolated on disk | ❌ (single working tree) | ✅ (one directory per branch) | ✅ |
| Shared `.git` history | ✅ | ✅ (a single one) | ❌ (duplicated) |
| Disk cost of a 2nd workspace | — | weight of the files only | the whole `.git` again |
| `fetch` in A visible in B | — | ✅ instantly | ❌ |
| Shared hooks/config | — | ✅ | ❌ (to reconfigure) |
| Anti double-checkout guardrail | — | ✅ Git refuses | ❌ |

The worktree is "one brain, several bodies". Multi-clone is isolated silos.

## The wrong way (common)

```bash
# from an already cloned repo
git worktree add ../my-feature
```

It works, and it is acceptable for a one-off need. But it scatters sibling
directories and the "main" directory stays a privileged checkout. For regular
use, prefer the *bare* layout below.

## The right way: the "bare" layout

The idea: the root directory contains **no** code, only the history hidden in
`.bare`, and each branch is a subdirectory (worktree).

```bash
mkdir my-project && cd my-project

# 1. Clone the history only (no working tree) into a hidden directory
git clone --bare git@github.com:user/repo.git .bare

# 2. Tell the root directory where the history is
echo "gitdir: ./.bare" > .git

# 3. Fix the refspec: without this, a bare clone only "sees" the default branch
git config remote.origin.fetch "+refs/heads/*:refs/remotes/origin/*"

# 4. Fetch all the remote branches
git fetch --all

# 5. Create the worktrees
git worktree add main
git worktree add feature/payment
```

Result:

```
my-project/
├── .bare/            # the single Git history (objects, refs, hooks, config)
├── .git             # text file: "gitdir: ./.bare"
├── main/            # worktree of the main branch
└── feature/
    └── payment/     # worktree of the feature/payment branch
```

The one-line `.git` file is the "glue": it makes the terminal believe the root
is a repo, without putting a working tree in it. You can thus run the `git
worktree` commands from the root.

### The "blind bare clone" pitfall

After a `git clone --bare`, Git assumes you want a mirror/backup, not a
workspace. It **does not configure remote-branch tracking**: a `git fetch` only
brings back the default branch. Symptom:

```
$ git fetch
 * branch            HEAD       -> FETCH_HEAD      # and nothing else
```

The fix is step 3 above (the `+refs/heads/*:...` refspec). After that,
`git fetch --all` sees all the team's branches.

## Full syntax of `worktree add`

```bash
git worktree add <directory> [-b <new-branch>] [<start-ref>]
```

Examples:

```bash
# new branch feat/fix-db starting from feature/improve-db
git worktree add improve-db -b feat/fix-db feature/improve-db

# slashes create subdirectories: features/A -> directory features/A + branch features/A
git worktree add features/A
```

## The pitfalls to know

- **`rm -rf` is not enough** to remove a worktree: Git keeps the reference. A
  future `git worktree add` will fail ("already exists"). Fix:
  ```bash
  git worktree list      # spot the "prunable" entries
  git worktree prune     # clean up the orphan references
  ```
  (No risk: `prune` never touches the remote branches.)
- **Protect a worktree** against prune: `git worktree lock` / `unlock`.
- **Double checkout forbidden**: Git refuses to check out the same branch in two
  worktrees. It is a protection, not a bug.

---

## Enrichments (beyond the article)

### Convert an existing NORMAL repo to the bare layout

The article starts from an empty directory. But you can convert a classic clone
to the worktree layout **without re-cloning** — it is Git plumbing, **O(1),
independent of the code size** (10 MB or 10 GB: same duration):

```bash
cd my-normal-repo           # contains a classic .git/
mv .git .bare               # the history becomes the bare
git --git-dir=.bare config core.bare true
echo "gitdir: ./.bare" > .git
git --git-dir=.bare config remote.origin.fetch "+refs/heads/*:refs/remotes/origin/*"
# optionally move your current code into a main/ worktree
git worktree add main <current-branch>
```

**Important consequence**: since the conversion is instantaneous on demand, the
"do it early to be future-proof" argument is weak. You can switch any repo to
worktree mode the day you need it. By default, keep a standard repo: the bare
layout has a daily cost (see below).

### Share `node_modules` and `.env` between worktrees

**The article does not mention it, and it is the real friction point.** Each
worktree is a fresh working tree. **Versioned** files (code, `CLAUDE.md`,
committed configs) appear on their own. But **unversioned** files
(`node_modules`, `.env`, `.env.local`) are **absent** from each new worktree.

Two strategies depending on the file:

- **`.env` / `.env.local`** → symlink. Small, unversioned, we want the same
  secrets everywhere.
  ```bash
  ln -s ../../my-repo/.env feature/payment/.env
  ```
- **`node_modules`** → **depends on the package manager**:
  - **simple project (npm)**: a symlink of `node_modules` is enough and avoids a
    reinstall.
  - **pnpm / yarn workspaces monorepo**: **DO NOT symlink**. pnpm stores a
    `.pnpm` virtual store tied to the workspace root; a global symlink corrupts
    it. Run `pnpm install` in the worktree instead — it is fast (hard-links from
    the global store, zero re-download).

> ⚠️ The shared files must be **gitignored** (`.env`, `node_modules` almost
> always are). Otherwise the symlinks show up as untracked files and pollute
> `git status`.

### When NOT to use worktrees

The worktree solves **mechanical isolation**, never the **parallelizability of
the work**. It does not help if:

- **Your changes are sequential / dependent** (a "list of successive changes":
  each step depends on the previous one). Branching them in parallel = constant
  rebases and conflicts. Roll them out one step at a time.
- **The features touch the same files.** Three branches on the same `service.ts`
  = merge hell.
- **Review is the bottleneck.** With AI agents that produce fast, the ceiling is
  no longer the keyboard but **your eyes**. Parallelizing critical code
  (payment, KYC) that you cannot review in time is dangerous. The worktree
  protects the Git state, not the semantic consistency between branches.

Good use case: **genuinely independent** features (disjoint code areas), on a
**stable foundation**, with **enough review capacity**.

### The daily cost of bare-by-default

Do not put *all* your repos in bare "just in case". You would pay 100% of the
time for a need that rarely arises:

- your code is no longer in `repo/` but in `repo/main/` → hard-coded paths,
  `docker-compose` volumes, IDE workspaces, CI to adjust;
- unshared `node_modules`/`.env` → permanent symlink ritual, even solo;
- onboarding friction: a colleague discovers a `.bare` and a weird `.git`.

## Cheat-sheet

```bash
# Pro setup (empty directory)
git clone --bare <url> .bare
echo "gitdir: ./.bare" > .git
git config remote.origin.fetch "+refs/heads/*:refs/remotes/origin/*"
git fetch --all
git worktree add main

# Daily life
git worktree add ../hotfix -b hotfix/bug main   # new worktree + branch
git worktree list                               # list (spot the prunable ones)
git worktree remove <directory>                 # remove (keeps the branch!)
git worktree prune                              # clean the orphan refs
git worktree lock/unlock <directory>            # protect from prune
```

## Automation

The [`coding-flow`](https://github.com/LandryPouth/coding-flow) tool provides
`ai-flow worktree add|list|remove`: it creates the worktree, symlinks `.env`,
detects pnpm/npm to choose install vs symlink of `node_modules`, and keeps the
branch on `remove`. See the project doc `docs/plans/parallel-mode.md`.

## Init script (put it in `~/.local/bin/wtree`, `chmod +x`)

```bash
#!/bin/bash
# Usage: wtree <git url>  (in an EMPTY directory)
set -euo pipefail
REPO_URL="${1:?Usage: wtree <repo-url>}"
[ -z "$(ls -A | grep -v "$(basename "$0")")" ] || { echo "❌ Directory not empty"; exit 1; }
git clone --bare "$REPO_URL" .bare
echo "gitdir: ./.bare" > .git
git config remote.origin.fetch "+refs/heads/*:refs/remotes/origin/*"
git fetch --all
echo "✅ Ready. Next step: git worktree add main"
```

---

*Original source: Metal3d, "Git worktree like a boss", dev.to. "Enrichments"
sections added here.*
