# Story 30-01 — A story is verified in each of its repositories

## User Value

In a workspace that holds `api/` and `web/` as independent git repositories,
one `ai-flow verify --story <dir>` runs the validation commands of every
repository the story names, each inside that repository, and writes one
evidence that says which repository was proven at which commit. `status`
then shows the story `verified` only when all of them are green. This is the
walking skeleton: config → story → verify → evidence → status, across
repositories, without worktrees yet (each repository's checkout is used as is).

## Requirements

- **Config.** `.coding-flow/config.json` accepts
  `repos: { <name>: { path, base?, validation?: { commands, quality? }, coverageReports? } }`.
  `path` is relative to the project root, must be a directory holding its own
  git repository (`git -C <path> rev-parse --show-toplevel` equals it).
  `base` defaults to the repository's default branch resolution in
  `diff-base.js`. A repository without `validation` uses the commands detected
  from its own `package.json` (same rules as today, rooted there).
- **Story.** A `## Repos` section (or a `Repos:` line in `story.md`) lists
  names, comma-separated. In workspace mode a story without it, or naming an
  unknown repository, is refused with exit 2 and the list of declared names.
- **Verify.** For each named repository, in order: resolve its diff base in
  that repository, run its commands with `cwd` = the repository path, record
  results. The verdict is `verified` only if every repository is green.
  One repository red → the story is red; the output names the repository.
- **Evidence.** One evidence file per story (as today, in the workspace), with
  `repos: { <name>: { path, head, base, commands: [...], result } }`. The
  top-level `head` is absent in workspace mode (no single HEAD exists).
- **Status.** Freshness is per repository: the story is `stale` when any
  repository's HEAD differs from its recorded head.
- **No `repos` key → today's behaviour, unchanged.**

## Acceptance Criteria

- [ ] Given a workspace with `repos.api` and `repos.web` and a story with `## Repos: api, web` whose commands pass in both, when `ai-flow verify --story` runs, then it exits 0 and the evidence holds `repos.api.head` and `repos.web.head` equal to each repository's `git rev-parse HEAD`.
- [ ] Given the same story where `web`'s command exits 1, when verify runs, then it exits non-zero, the output names `web`, and `status` shows the story `blocked`.
- [ ] Given a verified story, when a commit lands in `api` only, then `status` shows it `stale` and names `api`.
- [ ] Given a workspace story with no `## Repos`, when verify runs, then it exits 2 and prints the declared names `api, web`.
- [ ] Given `## Repos: mobile` and no `repos.mobile`, when verify runs, then it exits 2 naming `mobile` as unknown.
- [ ] Given a `repos.api.path` that is not a git repository, when verify runs, then it exits 2 naming the path.
- [ ] Given a project with no `repos` key, when the existing suite runs, then it is green with no change to its expectations.

## Edge Cases

- A repository path reached through a symlink: compare real paths (as
  `guard.js` `projectRoots` already does).
- The workspace itself is a git repository: its own HEAD is not part of the
  proof; a story touching only workspace docs names no repository and is
  verified by the workspace's own commands, if any (today's behaviour).
- Two repositories with the same command (`pnpm test`): run twice, once per
  `cwd`; never deduplicated.

## Out of Scope

Worktrees (30-02), coverage and scan (30-03), guard (30-04), ship (30-05),
`init` (30-06).
