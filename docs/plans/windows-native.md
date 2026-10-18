# Native Windows (no WSL) — where it stands, 2026-10-18

Status: **assessment only, nothing planned or built yet.** Written so the work can
be picked up later. Everything below is read in the code or in CI config; nothing
was run on a Windows machine for this note.

## What works (covered by CI on `windows-latest`, Node 22)

- The CLI (`ai-flow init`, `status`, `verify`, `harness`, worktrees…): zero
  dependencies, `node:*` only, `git`/`gh` called through `execFileSync` (no shell).
- Path handling: case-insensitive comparison (`util.js`, `guard.js`
  `CASE_INSENSITIVE`), 8.3 short names, `C:/…` paths from git, symlink tests
  skipped with a stated reason where Developer Mode is needed.
- Story `verify` commands run through `shell: true` (`validation-run.js:247`), i.e.
  `cmd.exe` on Windows.

## What is broken or unverified

1. **Claude Code guard hook.** `guardCommandString()` (`bin/lib/settings.js:86`)
   writes a POSIX command into `.claude/settings.json`:
   `R="$CLAUDE_PROJECT_DIR/bin/ai-flow.js"; if [ -f "$R" ]; then node "$R" guard; else npx --yes … guard; fi`.
   Claude Code on native Windows runs it through Git Bash if installed, else
   PowerShell. Nobody has seen the guard refuse a write there, so per
   design-decisions entry 10 it must not be claimed. README line 58 already says
   "not covered by CI there".
2. **Guard grammar is shell-text based.** It reads bash forms (`> .env`, `tee`,
   `sed -i`, `cp`/`mv`). PowerShell (`Set-Content`, `Out-File`, `>` with
   encodings) and `cmd` (`copy`, `echo x > .env`) writes are not parsed; only
   the Write/Edit tools are reliably covered.
3. **`pre-push` git hook** is `#!/bin/sh` (`bin/lib/hook.js:23`). Works with Git for
   Windows (bundled sh); not tested.
4. **`worktree autoland`** can leave the landed worktree directory behind (Windows
   cannot delete the current directory; removal is retried best-effort). Known,
   open.
5. **OpenCode guard** is a plugin inside OpenCode's own Node process (no shell
   dependency), so it is the most likely path to work — but a real refusal on
   Windows has not been observed.
6. **Verify authoring.** Verify commands written in bash syntax (`export`, `$VAR`,
   `test -f`) fail under `cmd.exe`; only `&&`, `npm test`, `node script.js`
   style commands are portable.

## What "supported" would take

- A hook command with no bash: e.g. `node "%CLAUDE_PROJECT_DIR%/bin/ai-flow.js" guard`,
  or a small Node launcher that owns the `npx` fallback and the missing-file case.
  Needs a per-platform command in `settings.js` and a `doctor` check.
- A real proof on `windows-latest`: drive the hook (or the real Claude Code) and
  see a write refused. Until then the README keeps saying "not covered".
- Either teach the guard PowerShell/`cmd` write forms, or list them under "What the
  guard does not see" in the README.
- Decide the `pre-push` story (rely on Git for Windows' sh, or a Node hook).
- Fix or document `autoland` on Windows.
- Guidance for portable `verify` commands (docs + `doctor` warning).

## Constraints to respect when this is picked up

- Project is frozen to bugs/DX/docs/tests (freeze after Spec Kit); this is a
  multi-story epic, so plan it with `/flow-plan` rather than inline.
- Overlaps with epic-01 (multi-platform): self-test every platform before claiming
  a guard; Codex sandbox is real, others were not.
- A platform gets a guard only when it was seen refusing a write for real.
