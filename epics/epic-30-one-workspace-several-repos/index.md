# Epic 30 — One workspace, several repositories

## Goal

One Coding Flow install in a container folder governs several independent git
repositories nested in it (an API and a web app with their own remotes, base
branches and teams). Epics and stories live once, in the workspace; each story
names the repositories it touches; worktrees, verify, coverage, evidence, the
guard, status and ship each act in the right repository. No second install,
no hand-copied plan, no "without Coding Flow" mode.

## Why

- **The maintainer asked for it (2026-11-21)** while taking over tse-binam:
  "je veux juste une installation qui pointe vers l'api et le web en même
  temps (vu que j'ai repris le projet en main, mais c'est le bordel)" — and
  "crée l'epic pour coding flow (je vais l'implémenter après et une fois que
  c'est ok je l'installerai dans tse binam)".
- **Measured on tse-binam (2026-11-21).** `~/dev/sabytoo/tse-binam/` is a
  plain folder, not a repository, holding `api/` (NestJS, remote
  `GMK-C/tse-binam-api-v1`, base `develop`) and `web/` (Next.js, remotes
  `LandryPouth/genealogie_app` and `TheBigSteph/genealogie_app`, base
  `develop`). Each work order is written once in `web/docs/plans/` with a
  pointer file in `api/docs/plans/`; every lane opens one worktree per
  repository by hand; the `epic-run` skill runs there in its "Sans Coding
  Flow" fallback, so the proof is a hand-written list of commands, not a
  captured verify.
- **Today the tool refuses or misjudges this layout, by design:**
  - `worktree-plan.js:80-90` `requireProjectRootIsGitRoot` throws
    "Multi-install monorepos are not supported for automatic placement/land".
  - `worktree.js` `requireRepo` (`:67`) and `ship.js` `requireRepo` (`:79`)
    resolve one `--show-toplevel` from the project root.
  - `diff-base.js` and `diff-scope.js` read one repository's history: a
    change made in `api/` is invisible to a verify started from the workspace.
  - `evidence.js:268` records one `HEAD`.
  - README "Nested projects": a nested git repo with no `.coding-flow/` gets
    the default guard policy, not the workspace's.
  - Installing twice (one per repository) duplicates epics, rules and the
    human to-do list — what the maintainer explicitly refused.

## Scope

**In scope**

- A `repos` map in `.coding-flow/config.json` (name → path, base branch,
  validation commands, coverage reports, remote for ship). Absent → today's
  behaviour, byte for byte.
- A `## Repos` line in a story (`api, web`); verify runs each declared
  repository's commands in that repository (or its worktree), diff base and
  evidence per repository.
- One worktree per declared repository for a story, same branch name in each;
  lock, unlock and land per repository with an all-or-nothing preflight.
- Coverage gate, test-change rule and `scan` per repository.
- The workspace guard policy governs the declared repositories.
- `ship`: one branch push and one PR per repository, cross-linked; `status`,
  `next` and `doctor` aware of repositories.
- `ai-flow init --workspace`: detect nested repositories, write `repos`,
  keep them out of the workspace's own git.

**Out of scope (Later)**

- Git submodules and subtrees (the repositories stay independent; the
  workspace never records their commits).
- More than one level of nesting; a repository that is itself a workspace.
- Atomic cross-repository commits or a single cross-repository PR.
- Converting a workspace into a monorepo.
- `storage: github` for the workspace's epics.
- Driven runs (`ai-flow run`, epic 20) across repositories: they read the
  same per-repository evidence once this ships; any extra scheduling belongs
  to 24 (many hands).

## Backbone

Backbone: declare the repositories → a story names its repositories → verify
proves each one → each one gets its worktree and lands → the guard holds in
each → each one ships its PR → a new workspace is installed in one command.

```text
s1
├── s2 ──── s5
├── s3
├── s4
└── s6
```

- s2, s3, s4 and s6 touch disjoint files (`worktree*.js`; `coverage*.js`,
  `scan.js`; `guard.js`; `init`/`detect.js`/templates) and run in parallel
  after s1.
- s5 (ship, status, next, doctor) needs s2's per-repository branches.

## Stories

1. [story-30-01-a-story-is-verified-in-each-of-its-repos](story-30-01-a-story-is-verified-in-each-of-its-repos/spec.md) — `repos` config, `## Repos` line, verify and evidence per repository *(STANDARD — walking skeleton)*
2. [story-30-02-each-repo-gets-its-worktree-and-lands](story-30-02-each-repo-gets-its-worktree-and-lands/spec.md) — one worktree per declared repository, lock/unlock/land with an all-or-nothing preflight *(STRICT — merges)*
3. [story-30-03-coverage-and-scan-per-repo](story-30-03-coverage-and-scan-per-repo/spec.md) — test-change rule, coverage reports and `scan` judged per repository *(STANDARD)*
4. [story-30-04-the-workspace-guard-holds-in-each-repo](story-30-04-the-workspace-guard-holds-in-each-repo/spec.md) — the workspace policy governs the declared repositories *(STRICT — guard)*
5. [story-30-05-one-pr-per-repo-and-a-status-that-sees-them](story-30-05-one-pr-per-repo-and-a-status-that-sees-them/spec.md) — `ship` per repository with cross-links; `status`, `next`, `doctor` per repository *(STANDARD)*
6. [story-30-06-a-workspace-is-installed-in-one-command](story-30-06-a-workspace-is-installed-in-one-command/spec.md) — `ai-flow init --workspace` *(STANDARD)*

## Decisions

- **Opt-in, invisible otherwise.** No `repos` key → every command behaves
  exactly as today (the existing suite is the regression proof). A workspace
  is detected only from the config, never guessed from folders.
- **The workspace is the project root; the repositories are not projects.**
  `.coding-flow/` lives once, in the workspace. A declared repository holding
  its own `.coding-flow/` is a `doctor` error, not a silent second policy.
- **The workspace may or may not be a git repository.** When it is, it tracks
  epics, rules and docs, and every declared repository must be ignored by it
  (`doctor` checks `git check-ignore`). When it is not, epics are plain files
  and the proof still lives in each repository's evidence.
- **A story names its repositories; nothing is guessed.** In workspace mode a
  story without `## Repos` is refused by verify and worktree with the list of
  declared names. A name not in `repos` is an error.
- **Same branch name in every repository of a story** (`story-NN-MM-…`), so
  the story↔worktree mapping stays stateless (README "With `--story`, the
  worktree↔story mapping is stateless").
- **Evidence is one file per story, with one entry per repository**
  (`repos.<name>: { head, base, commands, coverage, scan }`). The story is
  `verified` only when every declared repository is green on its fresh HEAD;
  `stale` as soon as one repository moved.
- **Land is all-or-nothing at preflight, sequential at execution.** Every
  repository is checked (clean, fast-forwardable or mergeable, verify fresh)
  before the first merge; if a merge then fails, the ones already done are
  reported with their exact rollback command, never undone automatically.
- **One PR per repository.** Each PR body links the others and carries its own
  repository's evidence; there is no cross-repository PR.

## Dependencies outside this epic

`config.js` (schema and validation), `story.js` (sections), `diff-base.js`,
`diff-scope.js`, `harness.js` / `validation-run.js` (command runner),
`evidence.js`, `status.js`, `worktree.js`, `worktree-plan.js`,
`coverage-gate.js`, `coverage.js`, `scan.js` (29-01), `guard.js`, `ship.js`,
`next.js`, `doctor.js`, `detect.js`, `bootstrap.js`.
29-01 (`scan`) must have shipped for s3's scan part; otherwise s3 covers the
coverage gate only and says so.

## Delivery order

s1 first. Then s2 ∥ s3, then s4 ∥ s6, then s5. Scheduled in the unattended run
of `docs/plans/autonomous-run.md` as wave 2b, after wave 2 (29-01 `scan`, 29-03
guard), at the maintainer's request on 2026-11-22.

## Readiness

`ready`. Open questions were settled as labelled assumptions in each story's
`plan.md` (the maintainer reviews them before the run).

## Maintainer cleanup on delivery

- `~/.claude/skills/epic-run/SKILL.md`: remove the "Sans Coding Flow dans le
  projet" section's tse-binam use; per-repository worktrees come from
  `ai-flow worktree add --story`.
- tse-binam: install with `ai-flow init --workspace` in
  `~/dev/sabytoo/tse-binam/`, move the open work order
  (`web/docs/plans/ordre-travail-2026-11-21.md`) into a workspace epic, delete
  the pointer files in `api/docs/plans/`.

## À faire côté utilisateur

_(filled by the stories)_
