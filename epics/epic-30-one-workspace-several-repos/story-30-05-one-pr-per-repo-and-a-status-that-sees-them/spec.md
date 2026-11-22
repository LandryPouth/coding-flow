# Story 30-05 — One PR per repository, and a status that sees them

## User Value

`ai-flow ship --story` pushes the story branch of each repository to that
repository's remote and opens (or updates) one PR per repository, each linking
the others and carrying its own evidence. `status`, `next` and `doctor` show a
story's state per repository, so "api landed, web still open" is visible at a
glance.

## Requirements

- **Ship.** Per repository: push `<branch>` to `repos.<name>.remote` (default
  `origin`), open/update a PR against its base (`gh -R <owner/repo>` resolved
  from that remote). Idempotent as today (one branch = one PR). Each body
  gets a "Same story in" list with the other PRs' URLs, refreshed on every
  ship, and only its repository's evidence.
- **Partial ship.** A push or PR failure in one repository does not undo the
  others; the output lists each repository with its result and the retry
  command.
- **Status / next.** `ai-flow status` shows, per story, one line per
  repository (`api verified 3f2a1c · web stale`). `next` ranks a story by its
  worst repository and names it.
- **Doctor.** Checks each declared repository: path exists, is a git
  repository, base branch exists, remote reachable (`git ls-remote`, skipped
  offline with a note), ignored by the workspace's own git when the workspace
  is one, holds no `.coding-flow/` of its own.

## Acceptance Criteria

- [ ] Given a landed-ready story naming `api, web` with fake remotes (bare repos) and a stubbed `gh`, when `ai-flow ship --story` runs, then each bare remote receives `<branch>` and two PR create calls are made, each body listing the other.
- [ ] Given a second ship after a new commit in `web`, then no new PR is created, both bodies are refreshed, and only `web`'s evidence changed.
- [ ] Given `web`'s push fails, then `api`'s PR still exists, exit is non-zero, and the retry command for `web` is printed.
- [ ] Given a story verified in `api` and stale in `web`, when `status` runs, then it shows both states on separate lines; `next` names `web`.
- [ ] Given a declared repository not ignored by the workspace's git, when `doctor` runs, then it reports an error naming it and the `.gitignore` line to add.
- [ ] Given no `repos`, ship/status/next/doctor suites are unchanged and green.

## Edge Cases

- Two repositories with different hosting owners (tse-binam: `GMK-C` and
  `TheBigSteph`): owner/repo resolved per remote, never shared.
- A repository with two remotes (fork + upstream): `repos.<name>.remote`
  chooses; absent → `origin`.
