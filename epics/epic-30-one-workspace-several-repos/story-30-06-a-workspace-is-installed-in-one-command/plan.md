# Plan — 30-06 A workspace is installed in one command

## Implementation Context

- Mode: STANDARD. Scout: no.
- Likely files: `bin/lib/commands.js` / `bin/ai-flow.js` (`init --workspace`
  flag and help), the init module (find it from `commands.js`),
  `bin/lib/detect.js` (per-repository command detection),
  `bin/lib/workspace.js`, templates if a workspace README block is added,
  README install section, `docs/QUICKSTART.md`, an eval case if a skill text
  changes (AGENTS.md rule).
- Avoid: touching any file inside a detected repository.

## Decisions

- Assumption (unconfirmed): repository names are folder names; renaming is a
  manual config edit.

## Test plan

- Throwaway folders: plain folder with two repositories; same as a git repo;
  existing config; nested `.coding-flow/`; worktree child; `--dry-run`.

## Acceptance Traceability

_(to fill)_

## Commands

```bash
npm test
```
