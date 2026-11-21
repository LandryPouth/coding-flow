# Plan — 30-01 A story is verified in each of its repositories

## Implementation Context

- Mode: STANDARD. Scout: yes (verify path crosses `evidence.js`,
  `validation-run.js`, `harness.js`, `diff-base.js`, `status.js`).
- Likely files: `bin/lib/config.js` (schema, validation of `repos`),
  `bin/lib/story.js` (`## Repos` section, `story.md` line),
  `bin/lib/evidence.js` (`verifyStoryOnce` loops over repositories;
  `currentHead` per repository; evidence shape), `bin/lib/validation-run.js`
  (`runValidationCommand` already takes a cwd? confirm, else add),
  `bin/lib/diff-base.js` (`resolveDiffBase(cwd, …)` called with the repo path),
  `bin/lib/status.js` (per-repository freshness), new `bin/lib/workspace.js`
  (load and validate `repos`, resolve a story's repositories — one deep module
  used by every later story), `docs/rules-and-limits.md`, README.
- Avoid: changing any code path when `repos` is absent; a second evidence
  file per repository; guessing repositories from folders.

## Technical notes

- `workspace.js` exports `loadWorkspace(projectRoot)` → `null | { repos }` and
  `storyRepos(workspace, storyDir)` → `[{ name, path, base, validation }]` or a
  typed refusal. Every later story calls these two.
- Commands detected per repository: reuse the detection with the repository
  path as root.
- Evidence freshness (`canStandIn`, `findReusableVerify`): the fingerprint
  includes each repository's head and command set.

## Decisions

- Assumption (unconfirmed): `## Repos` is a section heading with a
  comma-separated line, mirroring `## Status`; `story.md` accepts the same
  heading.
- Assumption (unconfirmed): repositories are verified sequentially in the
  order the story lists them (one heavy task at a time; WSL machines crash
  under parallel suites — measured on the maintainer's machine 2026-11-10).

## Test plan

- Fixture: `mktemp -d` workspace with `.coding-flow/config.json` and two
  `git init` repositories, each with a `package.json` whose `test` script
  exits 0 or 1 on demand.
- Cases = the seven acceptance criteria; plus symlinked repository path.
- Regression: the whole existing suite unchanged (no `repos`).

## Acceptance Traceability

_(to fill)_

## Commands

```bash
npm test
```
