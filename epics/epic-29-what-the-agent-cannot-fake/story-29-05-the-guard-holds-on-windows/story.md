# Story 29-05 — The guard holds on Windows

## Status: in-progress

PR #61 (develop → main, head e93ffc1) was red on `test (windows-latest, 22.x)`
only (run 45533563113, job 138934554291): six tests. This story finds the cause
of each failure, fixes the code where the code was wrong, and fixes the test where
the test was wrong, without weakening any assertion.

*(STRICT — it touches the guard's path reading.)*

## Cause of each failure

| Test | Cause | Fix |
|------|-------|-----|
| `guard-destructive.test.js` "git switch in the primary checkout is refused when primaryLocked" (`git -C <dir> switch main` allowed) | The test pasted `C:\Users\RUNNER~1\…` **unquoted** into a bash command. Bash reads a backslash outside quotes as an escape, so the word is `C:UsersRUNNER~1…`. The guard reads it the same way (`tokenize` gives `C:UsersRUNNER~1AppDatax`), and that path names no checkout. The guard was right; the command was not the one the test meant. | The path is quoted (`'${dir}'`). New assertions write the path the way Git Bash does (`/c/Users/…`), which the guard now reads (see below). |
| same file, "R2 P2 … the primary policy file from a worktree" (`rm <dir>/.coding-flow/harness.json` allowed) | Same unquoted backslash path. | Quoted, plus a Git Bash form assertion. |
| `rules-registry.test.js:439` "from a linked worktree, primaryLocked follows the primary checkout" | Same unquoted `git -C ${primary}`. | Quoted (both the deny and the allow line). |
| `guard-destructive.test.js` "S3-2: after one git timeout…" (expected `unchecked`, got allow) | The test puts a `#!/bin/sh` script named `git` first on PATH. On Windows, `execFileSync("git")` only finds `.com`/`.exe` (libuv), so the real git ran, nothing timed out, and the decision was allow. The guard code is not at fault, and no script can stand in for git there. | The fake git is now one Node file. On POSIX it is `git` through a `#!/usr/bin/env node` shebang. On win32, `git.exe` on the PATH is a copy of `node.exe` that loads the fake with `NODE_OPTIONS=--require`. (A `git.cmd` shim, the first idea, is never found: Node spawns a `.cmd` only through a shell.) Node reads `git -C <dir> <sub> …` as `--conditions <dir>` plus the script `<sub>`, and the fake rebuilds the git command line from `execArgv` and `argv`. It hangs on `config --get` and hands every other call to the real git. The assertion is unchanged. The guard tests' temp-dir removal retries (`maxRetries: 10`), because Windows frees the killed `git.exe` a moment late. S3-2 also asserts the reason names the timeout. To make that true, an unresolved alias now keeps the host's cause (`a git alias the guard could not resolve: git did not answer in time …`). The preload is removed as soon as the guard call returns. |
| `harness-fixers.test.js:203` "a fixer with its own time limit is killed at it" (EBUSY removing the temp dir) | `spawnSync(…, { shell: true, timeout })` kills `cmd.exe` only. The `node` it started keeps running in the temp dir, and `rmSync` gets EBUSY. On Linux the grandchild also survives (checked: a timed-out `sh -c "node …"` still wrote its file 1.5 s later), but Linux lets a directory in use be removed. | On win32, `runValidationCommand` kills the timed-out (or output-overflowed) shell's descendants. `taskkill /T` cannot walk from a parent that is already dead, so PowerShell lists `Win32_Process`, and `descendantsOf` picks the descendants by parent id. Because ids are reused, a process only counts if it was created after the command started and after its parent, and before any live process that now holds the shell's id. Then `taskkill /F /PID …`. The test proves the kill on Windows: the fixer writes a marker 2 s in and lives 20 s; the marker must never appear, and the temp dir is removed without retries. The POSIX limit is stated in the code: a process group would cut Ctrl-C, which is story 19-04's trade. |
| `harness-fixers.test.js:922` "a guard log cut otherwise than the guard trims it is a forbidden write" (exit 0, "no change to evaluate") | The test's fixer split the log on `'\\n'` inside `node -e "…"`. Through sh's double quotes that reaches node as `\n` (a newline). Through cmd.exe's it reaches node as a backslash and an `n`, so the split found one line, `slice(-199)` kept the whole file, and the "cut" was a pure append. The guard-log rule was right to call it the guard's own work. | The fixer builds the newline (`String.fromCharCode(10)`), so it cuts on every shell. The assertion is unchanged. |

The first Windows CI run of this story (run 45543675335) fixed all six and
found one more: "readDestructive is pure" used `cd /x` and expected
`path.resolve('/x')` (`D:\x`). In Git Bash `/x` is drive X, which the guard now
reads as `X:\`, so the test was asserting the old misreading. Its word is now
`/work`. The assertion is unchanged, and the drive mapping is pinned in
`test/windows-paths.test.js`.

## The code change: Git Bash paths

On Windows the agent's shell is Git Bash (MSYS), and it writes a checkout as
`/c/Users/x/repo`. Before this story the guard resolved that word with
`path.resolve`, which gives `<current drive>:\c\Users\x\repo`, a directory that
does not exist. So `git -C /c/…/primary switch main` and
`rm /c/…/primary/.coding-flow/harness.json` were judged against the wrong place.

`nativeShellPath` (in `bin/lib/shell-writes.js`) is the one place that turns a
shell word into a platform path. On win32 it turns `/x/…` and `/cygdrive/x/…`
into `X:/…` (`/c` alone becomes `C:/`) and leaves any other word as written; on
every other platform it returns the word unchanged. It is used by `expandHome`,
which every shell-write path goes through, and by `destructive.js` `resolveIn`,
which reads `-C` and `cd`.

The checkout comparisons themselves (`primaryLock`, `effectiveDestructivePolicy`,
`settle`) already go through `realPathOf` (`fs.realpathSync.native`) and
`path.resolve`, and compare paths git printed with paths git printed; win32's
`path.relative` folds case. They were not the cause and are left as they are.

## Review round 1 (fresh reviewer: security/bypass, test honesty)

- P1-1: the kill was not proven. The cleanup's retries outlasted the child
  (5 s), so a do-nothing kill passed too. Fixed with the marker test, and the
  `project()` cleanup has no retries.
- P1-2: a parent id alone could kill an unrelated orphan, because Windows
  reuses ids. Fixed with the creation-time filter, an impostor bound and a
  visited set, all pinned on Linux by recorded process lists (a reused-id
  orphan, an impostor holding the shell's id, a cycle).
- P2 fixed:
  - `findReaches` resolved a `find` start without expanding `~`. On every
    platform, `find ~/p/.coding-flow -delete` was allowed while
    `rm ~/p/.coding-flow/harness.json` was denied. It now expands `~`, with a
    Linux test that fails before the fix.
  - S3-2 asserts the timeout reason.
  - `readDestructive` takes its platform from the host, so the win32 reading
    is tested from Linux.
  - S3-2's preload ends with the call.
  - An output overflow kills the tree too.
- P2 accepted: `nativeShellPath` follows Git Bash. When the agent's shell on
  Windows is PowerShell or cmd, a `/c/x` word names `<current drive>:\c\x`
  there, and the guard reads it as `C:\x`. That is a misreading in either
  direction. Claude Code and OpenCode run Bash commands through Git Bash on
  Windows, so Git Bash's reading is the one kept.

## Acceptance Criteria

- [ ] Given a path written as Git Bash writes it (`/c/…`, `/cygdrive/d/…`,
      `/c`), when read on win32, then it names the drive path; on Linux and
      macOS, and for any other word, it is unchanged.
- [ ] Given a linked worktree and `primaryLocked`, when the agent runs
      `git -C <primary> switch main`, `cd <primary> && git switch main` or
      `rm <primary>/.coding-flow/harness.json`, the path quoted or in shell
      form, then the guard denies it.
- [ ] Given a fixer that outlives its time limit, then it is reported
      `timedOut`, and on win32 what its shell started is killed.
- [ ] Given a fixer that cuts the guard log to 199 lines, then verify refuses
      it as a forbidden write on every platform.
- [ ] Given a git that hangs on its first lookup, when one decision needs
      four, then it is `unchecked` after one timeout, on every platform the CI
      runs (the fake git runs on Windows too).
- [ ] Given `find ~/<project>/.coding-flow -delete` with `~` the project's
      parent, then the guard denies it as it denies the `rm`.
- [ ] Given the PR CI, then `test (windows-latest, 22.x)` and every other job
      are green.

## Acceptance Traceability

1. test/windows-paths.test.js::a Git Bash path is read as the Windows path it names, on Windows only
2. test/guard-destructive.test.js::git switch in the primary checkout is refused when primaryLocked (the shell form is exercised for real on the Windows CI job)
3. test/harness-fixers.test.js::a fixer with its own time limit is killed at it (the marker check runs on the Windows CI job) — test/windows-paths.test.js::a timed-out command on Windows kills only what it started, found by parent id and creation time
4. test/harness-fixers.test.js::a guard log cut otherwise than the guard trims it is a forbidden write
5. test/guard-destructive.test.js::S3-2: after one git timeout, the other git lookups of the same decision are skipped (Windows CI)
6. test/guard-destructive.test.js::find START -delete reaches the policy file through ~, as rm does
7. Windows CI run on the draft PR (recorded in Result)

## Commands

```bash
npm test
```

## Result

- Linux: `npm test` passed (1969 passed, 0 failed, 2 TODOs owned by story 26-08).
  `ai-flow verify --story` passed on the story merged with develop (19-10
  included); evidence is in `.coding-flow/runs/2026-11-25T03-50-51-753Z-verify.json`.
- Draft PR #62 (CI only, not to be merged):
  - Run 45543675335: the six failures from PR #61 were fixed. One new
    failure appeared ("readDestructive is pure", `/x` is a drive) and was
    fixed in ec6efd3.
  - Run 45547651944: every job passed — ubuntu 18/20/22, macOS 22 and
    **windows-latest 22.x** (30 min 32 s).
    https://github.com/LandryPouth/coding-flow/actions/runs/45547651944
