# Epic 10 — Execution and ship safety

## Goal

`ship` commits only what belongs to the story, commands written by an agent
never run unattended with the developer's privileges, the CLI is tested on
the OSes it claims, and every published version has a tag and a release.

## Why

From the external audit, each point checked in the code
(`docs/plans/hardening-roadmap.md`):

- `ship.js` `autoCommitDirtyTree` (~292) stages with `git add -A` after a
  quick secret scan: a shared checkout with unrelated edits ships them in the
  story's PR.
- `resolveValidationCommands` (~1309) uses `config` first, then a story's
  `plan.md`. bethl never hit the second source (341/341 `config`), so the
  risk is theoretical today — but in CI or an unattended `autoland`, a
  `plan.md` written by an agent is code executed with the runner's
  environment, secrets included.
- `.github/workflows/test.yml` runs Node 18/20/22 on `ubuntu-latest` only;
  the CLI handles paths, shells and symlinks (and will handle more after
  epic-05) that behave differently on Windows and macOS.
- GitHub Releases stop at v0.8.3 while npm is at 0.12.1: what is installed,
  published and tagged cannot be matched.

## Scope

**In scope**

- `ship`: stage only story-scoped changes by default; `--all` to keep today's
  behaviour; dry-run lists exactly what would be committed.
- Command provenance: `plan.md` commands run only interactively (TTY) or with
  `--allow-plan-commands`; in CI (`CI=true`) or `autoland`, refused with a
  message. Optional `--clean-env` drops environment variables whose names
  match the sensitive patterns.
- CI matrix: `windows-latest` and `macos-latest` on Node 22 (Ubuntu keeps
  18/20/22).
- Release script: tag + GitHub release from the CHANGELOG section, run by the
  maintainer **after** their own `npm publish`; `doctor` in this repository
  warns when `package.json`'s version has no tag.

**Out of scope — decisions made while planning**

- **Publishing to npm from a script.** The maintainer publishes by hand; the
  release script never runs `npm publish`.
- **A process sandbox for validation commands.** Same reasoning as epic-05:
  OS isolation is the answer, documented, not reimplemented.

## Backbone

`Backbone: a story is done → ship stages only the story's files (or --all) → commits → pushes → PR; meanwhile verify refuses plan.md commands when unattended; CI proves the CLI on three OSes; the maintainer publishes and runs the release script`

### Story dependency tree

```text
s1
s2
s3
s4
```

## Stories

1. **story-10-01-ship-stages-the-story-only** *(STRICT — writes commits)*
2. **story-10-02-plan-commands-need-a-human** *(STANDARD)*
3. **story-10-03-ci-on-windows-and-macos** *(STANDARD — fixing what the new
   matrix finds is part of the story)*
4. **story-10-04-tags-and-releases-follow-npm** *(QUICK)*

## Decisions

- **"Story-scoped" = the story's diff scope from epic-07 plus files the
  dirty tree adds under paths the story already touches, plus the story's
  own directory.** Anything else is listed and left uncommitted, with the
  `--all` hint. Depends on 07-01.
