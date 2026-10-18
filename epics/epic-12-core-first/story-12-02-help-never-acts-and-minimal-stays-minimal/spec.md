# Story 12-02 — `--help` never acts, and minimal stays minimal

## User Value

Asking for help cannot change a repository, and a core-only install does not
grow layers because someone re-ran `init`.

## Requirements

- `ai-flow <command> --help` and `-h`, for **every** command and subcommand,
  print that command's usage (from the same table `ai-flow --help` uses) and
  exit 0 **before** any file, git or network operation.
- `init` on a project whose config says `install: "minimal"` keeps it
  minimal: refreshes core files, wires guards, adds nothing else, and prints
  `Install: minimal (kept). Add the workflow layer with \`ai-flow init --full\`.`
- `init --full` is the only way to promote; it prints the list of what it
  will add and honours `--dry-run`.
- Same rule for `upgrade` (already documented as keeping minimal — add the
  test if missing).

## Acceptance Criteria

- [x] For each command listed by `ai-flow --help`: run `<cmd> --help` in a
      throwaway repo, assert exit 0, usage printed, and the directory tree +
      `git status` + `package.json` unchanged (snapshot before/after).
- [x] Minimal install, then `init` → config still `minimal`, no `RULES.md`,
      no `examples/`, no new package scripts, no `opencode.json` created.
- [x] Minimal install, then `init --full --dry-run` → lists additions,
      writes nothing; `init --full` → promoted.
- [x] Reproduces and fixes the 2026-10-16 incident (DOGFOODING row).

## Edge Cases

- Unknown flags on `init` (`--hlep`) must fail with "unknown flag" rather
  than be ignored and run the install.

## Status: done
