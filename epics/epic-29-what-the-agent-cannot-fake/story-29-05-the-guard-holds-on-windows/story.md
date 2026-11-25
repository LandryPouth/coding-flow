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
| `guard-destructive.test.js` "S3-2: after one git timeout…" (expected `unchecked`, got allow) | The test puts a `#!/bin/sh` script named `git` first on PATH. On Windows, `execFileSync("git")` only finds `.com`/`.exe` (libuv), so the real git ran, nothing timed out, and the decision was allow. The guard code is not at fault, and no script can stand in for git there. | The fake git is now one Node file. On POSIX it is `git` through a `#!/usr/bin/env node` shebang. On win32, `git.exe` on the PATH is a copy of `node.exe` that loads the fake with `NODE_OPTIONS=--require`. (A `git.cmd` shim, the first idea, is never found: Node spawns a `.cmd` only through a shell.) Node reads `git -C <dir> <sub> …` as `--conditions <dir>` plus the script `<sub>`, and the fake rebuilds the git command line from `execArgv` and `argv`. It hangs on `config --get` and hands every other call to the real git. The assertion is unchanged. The temp-dir removal now retries (`maxRetries: 10`), because Windows frees a killed process's files a moment late. |
| `harness-fixers.test.js:203` "a fixer with its own time limit is killed at it" (EBUSY removing the temp dir) | `spawnSync(…, { shell: true, timeout })` kills `cmd.exe` only. The `node` it started keeps running in the temp dir, and `rmSync` gets EBUSY. On Linux the grandchild also survives (checked: a timed-out `sh -c "node …"` still wrote its file 1.5 s later), but Linux lets a directory in use be removed. | On win32, `runValidationCommand` kills the timed-out shell's descendants by parent id (PowerShell `Win32_Process`, since `taskkill /T` cannot walk from a parent that is already dead). The POSIX limit is stated in the code: a process group would cut Ctrl-C, which is story 19-04's trade. |
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
- [ ] Given the PR CI, then `test (windows-latest, 22.x)` and every other job
      are green.

## Acceptance Traceability

1. test/windows-paths.test.js::a Git Bash path is read as the Windows path it names, on Windows only
2. test/guard-destructive.test.js::git switch in the primary checkout is refused when primaryLocked (the shell form is exercised for real on the Windows CI job)
3. test/windows-paths.test.js::a timed-out command on Windows has its descendants killed by parent id; elsewhere nothing runs — and test/harness-fixers.test.js::a fixer with its own time limit is killed at it (Windows CI)
4. test/harness-fixers.test.js::a guard log cut otherwise than the guard trims it is a forbidden write
5. test/guard-destructive.test.js::S3-2: after one git timeout, the other git lookups of the same decision are skipped (Windows CI)
6. Windows CI run on the draft PR (recorded in Result)

## Commands

```bash
npm test
```

## Result

*(Filled in once the Windows CI has run.)*
