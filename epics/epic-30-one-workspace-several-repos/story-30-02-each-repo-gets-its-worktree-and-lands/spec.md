# Story 30-02 — Each repository gets its worktree and lands

## User Value

`ai-flow worktree add --story <dir>` in a workspace opens one worktree per
repository the story names, on the same branch name, next to each repository.
Verify (30-01) then runs in those worktrees. `worktree land --story` merges
each branch into its repository's base only after every repository passed a
preflight, so a story never lands half-way without the human being told
exactly what happened and how to undo it.

## Requirements

- **Add.** For each named repository: `git -C <repo> worktree add
  ../<repo-dir>-worktrees/<story-branch> -b <story-branch> <base>` (sibling
  placement rule of README "Worktrees are placed as siblings"). Same branch
  name everywhere. Dependencies and `.env` handling follow today's per-repo
  rules (copy, never commit). Already present → reused, not recreated.
- **Mapping.** Stateless: a story's worktree in repository R is found by
  branch name in R. `verify --story` run from a story worktree, or from the
  workspace, resolves each repository's worktree when it exists, else its
  main checkout (and says which).
- **Lock / unlock.** Applied to every repository's worktree of the story.
- **Land preflight (all repositories, before any merge).** Each worktree is
  clean; its base can fast-forward or merge without conflict; the story's
  evidence is fresh for that repository's HEAD. Any failure → nothing is
  merged; exit non-zero; the output lists each repository with its blocker.
- **Land execution.** Sequential in story order, `--no-ff` like today. A
  failure after the first merge stops; the output lists the repositories
  already merged with their rollback command (`git -C <repo> reset --hard
  <pre-land tip>` printed, never run) and those not touched.
- **Remove.** After a successful land, each worktree and branch is removed
  per today's rules (`autoland`, "not-isolated" handled per repository).
- **`requireProjectRootIsGitRoot`** (`worktree-plan.js:80`) no longer throws in
  workspace mode; it still throws for a nested project that is not a
  declared workspace.

## Acceptance Criteria

- [ ] Given a workspace story naming `api, web`, when `ai-flow worktree add --story` runs, then `api-worktrees/<branch>` and `web-worktrees/<branch>` exist beside each repository, both on `<branch>` from their own base.
- [ ] Given those worktrees, when verify runs from the workspace, then the evidence records each worktree's HEAD, not the main checkouts'.
- [ ] Given `web`'s base moved and conflicts with the story branch, when `worktree land --story` runs, then no repository is merged, exit is non-zero, and `web` is named with "conflict".
- [ ] Given a clean preflight and a merge that fails in `web` after `api` merged, when land runs, then it stops, prints `api` as merged with its `reset --hard <sha>` rollback line, and does not run it.
- [ ] Given a successful land, then both bases contain the story branch as a merge commit and both worktrees and branches are gone.
- [ ] Given `--dry-run`, when land runs, then nothing changes and the preflight result per repository is printed.
- [ ] Given a project without `repos`, when the existing worktree suite runs, then it is unchanged and green.

## Edge Cases

- A repository whose base is checked out in its main folder with local
  changes: preflight blocker "main checkout dirty", never stash.
- Two repositories sharing the same parent directory: the sibling folders
  differ by repository directory name.
- A story naming one repository only: exactly today's single-repo behaviour,
  in that repository.
