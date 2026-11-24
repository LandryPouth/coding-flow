# Story 19-05 — Fixers run before the checks

## User Value

Mechanical problems are fixed before they are judged: a project declares
fixer commands (`eslint --fix`, `prettier --write`), verify runs them first,
lists the files they changed, and only then runs the checks. Lint was 49 of
bethl's 130 red runs (38 % of failing commands), almost all mechanical.

## Requirements

- `validation.fix` in `config.json`: a list of commands (same declaration
  rules as `validation.commands`: refused unattended unless declared in
  config, `--clean-env` honoured).
- Verify runs them before `validation.commands`, then records the files whose
  content changed (tree diff before/after) as `fixedFiles` in the evidence and
  prints them. Under `.coding-flow/`, a JSON file whose parsed value is
  unchanged is listed as `reformatted` and a guard log the guard itself wrote
  as `guardLogs` instead: every changed file is named, in one of the three.
- Changed files are left in the working tree; verify's tree token is computed
  after the fixers, so the proof is about the fixed tree.
- A fixer that exits non-zero is a red command like any other.
- Fixers never run in `--dry-run`. They run at the project root like any
  declared command: the tool lists what they changed inside the work tree and
  cannot stop a write elsewhere (a stated limit, `docs/rules-and-limits.md`).
- `/flow-setup` (or `init`'s config template) suggests `fix` entries when it
  detects eslint/prettier scripts, as a comment, never enabled silently.

## Acceptance Criteria

- [x] Given a fixer that reformats a file, when verify runs, then the checks
      run on the fixed file and the evidence lists it under `fixedFiles`.
- [x] Given a fixer that fails, then verify is red on that command.
- [x] Given no `validation.fix`, then verify behaves exactly as before.
- [x] Given an unattended run and a fixer declared only in `plan.md`, then it
      is refused like any plan command.
- [x] Given `--dry-run`, then no fixer runs.

## Edge Cases

- A fixer touching a test file in a driven run: the guard does not see shell
  writes made by a validation command; 19-07's protection is checked at the
  next verify by comparing test files with the base (documented there).

## Out of Scope

- Committing the fixed files (the agent or driver commits).
