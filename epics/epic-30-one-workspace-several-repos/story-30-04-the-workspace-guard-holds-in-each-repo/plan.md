# Plan — 30-04 The workspace guard holds in each repository

## Implementation Context

- Mode: STRICT (security boundary). Scout: yes (`guard.js` `projectRoots`,
  `hook.js`, platform adapters under `bin/lib/platforms`).
- Likely files: `bin/lib/guard.js`, `bin/lib/workspace.js` (repository and
  worktree roots), `bin/lib/doctor.js` (nested `.coding-flow/` error),
  README guard section, `docs/rules-and-limits.md`.
- Avoid: weakening any existing refusal; resolving roots by folder name.
- Rule of the repository (AGENTS.md): "A guard that is not verified is not
  claimed" — prove each refusal with a real hook run from Claude Code in a
  throwaway workspace, recorded in Result.

## Decisions

- Assumption (unconfirmed): the guard locates the workspace from a worktree
  through the repository's `git rev-parse --git-common-dir` → main checkout →
  enclosing workspace config.

## Test plan

- Throwaway workspace with two repositories and one story worktree; one test
  per acceptance criterion; one real Claude Code hook run per refusal kind.

## Acceptance Traceability

_(to fill)_

## Commands

```bash
npm test
```
