# Story 29-05 — The guard holds on Windows

## Status: done

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
| `harness-fixers.test.js:203` "a fixer with its own time limit is killed at it" (EBUSY removing the temp dir) | `spawnSync(…, { shell: true, timeout })` kills `cmd.exe` only. The `node` it started keeps running in the temp dir, and `rmSync` gets EBUSY. On Linux the grandchild also survives (checked: a timed-out `sh -c "node …"` still wrote its file 1.5 s later), but Linux lets a directory in use be removed. | On win32, `runValidationCommand` kills the timed-out (or output-overflowed) shell's descendants. `taskkill /T` cannot walk from a parent that is already dead, so PowerShell lists `Win32_Process`, and `descendantsOf` picks the descendants by parent id. Because ids are reused, a process only counts if it was created after the command started and after its parent; the shell's own children must also predate `spawnSync` returning and any live process that now holds the shell's id. The shell's own children are taken within 50 ms either side of that window, the clock-tick tolerance (see Review round 3). Then `taskkill /F /PID …`, and a second listing kills what the killed processes started before they died. The test proves the kill on Windows: the fixer writes a marker 2 s in and lives 20 s; the marker must never appear, and the temp dir is removed without retries. The POSIX limit is stated in the code: a process group would cut Ctrl-C, which is story 19-04's trade. |
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

## Review round 2 (fresh implementer)

- P1: the shell is dead when `spawnSync` returns, so its own children must have
  been created by then (`ended`, taken right after `spawnSync`). A process
  naming the shell's id but created later was started by a later holder of
  that id, listed or not, and it and its children are left alone. Deeper
  levels need no such bound: every parent there is alive and listed, so its
  id is its own, and a live descendant's later children stay in the tree.
  Pinned with the reviewer's repro and its converse in
  `test/windows-paths.test.js`.
- P2 overflow: `runValidationCommand` takes the kill as an option (`kill`,
  `killTree` by default), so the timeout and overflow paths are observed on
  every platform; dropping the overflow kill fails a test.
- P2 marker: the fixer writes `started.txt` with its own start time and the
  Windows wait runs from that; the test asserts the fixer started at all. Its
  limit went from 300 ms to 1 s so a slow Windows node can start; the marker
  is still 2 s after the start.
- P2 duration: `durationMs` is `ended - started`, measured before the kill;
  a test with a 1.5 s injected kill pins it.
- Note: the Windows run cited in Result predates rounds 1 and 2; the run at
  the new HEAD is pending.

## Review round 3 (fresh implementer)

- P1: `CLOCK_TOLERANCE_MS` (50 ms) widens both bounds on the shell's direct
  children. Windows stamps a creation time once per timer tick (15.6 ms) and
  `Date.now()` is a second clock, so a real child can read up to two ticks
  (~31 ms) off; 50 ms is that plus rounding. It is tens of ms, not seconds, so
  round 2's impostor (created hundreds of ms after `ended`) stays out; one that
  reuses the id and starts a child within 50 ms of the shell's death, then
  exits before the listing, would be taken. The selection is bounded, not
  exact, and the CHANGELOG says so. Pinned on both sides of both bounds (a
  tick inside, the edge inside, one ms beyond outside) in
  `test/windows-paths.test.js`.
- P2: `killTree` lists and kills twice. The second pass walks from the killed
  processes (dead roots, like the shell: children created between their own
  creation and the kill, both widened by the tolerance, and before any new
  holder of their id). `/T` was not used: it walks by parent id alone, the
  pid-reuse problem round 1 fixed. A process that forks faster than two passes
  still escapes. Pinned with an injected runner (a late child and its child
  killed, a stale orphan spared; a new holder of a killed id spared).
- P3: creation times go through `ToUniversalTime()` before the Unix
  conversion. .NET keeps the ambiguous-DST flag only on a local time made
  from UTC; whether CIM's DateTime does is not verified on Windows. A misread
  hour puts a child outside the window, which spares it rather than kills a
  stranger. Stated in the code comment.

## Review findings

### Round 2 — FAIL (test honesty; what the round-1 fixes introduced)

- [x] P1 bin/lib/validation-run.js:~343 (`descendantsOf`) — can still kill outside the tree: the shell dies at timeout, an unrelated A reuses its pid, spawns B and exits before PowerShell lists processes; A absent ⇒ `before` stays Infinity ⇒ B and its children killed. Repro: `descendantsOf([{200,100,S+5},{900,100,S+900},{901,900,S+950}],100,S)` → `[200,900,901]`. Contradicts the CHANGELOG claim — fix: also require the shell's direct children to be created before `spawnSync` returned; pin it in a test.
- [x] P2 bin/lib/validation-run.js:~391 — the overflow (ENOBUFS) kill is untested; removing it keeps every test green — fix: a `killTree` test with an injected runner, or a test of the overflow path.
- [x] P2 test/harness-fixers.test.js:~279 — the marker wait starts at test start, not fixer start; a slow verify start makes it pass with no kill — fix: the fixer writes a start file, wait from that.
- [x] P2 bin/lib/validation-run.js:416 — `durationMs` includes up to 30 s of PowerShell/taskkill — fix: take the duration before the kill.
- [x] Note: story Result cites Windows run 45547651944, which predates round-1 fixes; cite a run at the final HEAD.

### Round 3 — FAIL (the process-tree kill as a real mechanism)

- [x] P1 bin/lib/validation-run.js:349-351 (`descendantsOf` bounds) — `Date.now()` and WMI `CreationDate` (timer ticks up to 15.6 ms, rounded down) are compared with no margin: a real child stamped a tick before `started` (or a `b` in `a && b` stamped just after `ended`) is spared and keeps running. Reasoned, not reproduced; CI would show it as rare flakiness. CHANGELOG states the selection as exact. — fix: a small tolerance on the shell's direct children, sized to the clock tick (tens of ms, not seconds — a wide `ended` margin would re-admit round 2's pid-reuse impostor); boundary tests on both sides, including that round 2's impostor test still holds; state the tolerance in the comment and the CHANGELOG.
- [x] P2 validation-run.js:371-373 — a live descendant can start a child between the listing and `taskkill` (no `/T`), which survives — fix: list-and-kill twice, or `/T` on pids known alive.
- [x] P3 LIST_PROCESSES — `CreationDate` local time cast to `[DateTimeOffset]` is ambiguous in the repeated DST hour → no kill — fix: use UTC (`ToUniversalTime()` / `CreationDate` via CIM as DateTime UTC) if cheap, else document.

### Round 4 — PASS (the guard and verify on Windows end to end; round-3 regressions)

- [x] P2 test/windows-paths.test.js:49 and :158 — the impostor's child sits outside the `until` bound in both tests (+600 vs ENDED+50, killedAt+1100 vs killedAt+50), so removing the impostor check (`before`) in either pass keeps them green — fix: put the child inside the window (e.g. ENDED+20) and add the same case for the second pass; prove each fails without the check.
- [x] P3 CHANGELOG.md:70 / validation-run.js:~340 — the pid-reuse window is "between its death and 50 ms after the kill returned", not "within those 50 ms" — reword.
- [x] P3 shell-writes.js:1259 — `followScript` calls the nested `shellWrites` without `platform`; pass it through.

Held: Git Bash paths (`/x/…`, `/cygdrive/x/…`, `~`) across cd/pushd, git -C, globs and find; `durationMs` excludes the kill; Linux/macOS unchanged; UTC cast; second pass spares a surviving root; 18/18.
Series 1 ends at its cap with round 4 clean; STRICT needs a second clean round → series 2 round 1 after this fix.

### Round 5 — PASS (readiness to land and release) — second clean round in a row

- [x] P2 CHANGELOG: the DST limit added (a misread hour can only spare a real child, never kill a stranger).
- [x] P2 Result brought up to date (below).
- Criteria 1 and 6 are proved on Linux too; criteria 2–5 and 7 are proved only on Windows: by the required `test (windows-latest, 22.x)` job of this story's PR, which gates its auto-merge (branches protected 2026-11-25).

## Acceptance Criteria

- [x] Given a path written as Git Bash writes it (`/c/…`, `/cygdrive/d/…`,
      `/c`), when read on win32, then it names the drive path; on Linux and
      macOS, and for any other word, it is unchanged.
- [x] Given a linked worktree and `primaryLocked`, when the agent runs
      `git -C <primary> switch main`, `cd <primary> && git switch main` or
      `rm <primary>/.coding-flow/harness.json`, the path quoted or in shell
      form, then the guard denies it.
- [x] Given a fixer that outlives its time limit, then it is reported
      `timedOut`, and on win32 what its shell started is killed.
- [x] Given a fixer that cuts the guard log to 199 lines, then verify refuses
      it as a forbidden write on every platform.
- [x] Given a git that hangs on its first lookup, when one decision needs
      four, then it is `unchecked` after one timeout, on every platform the CI
      runs (the fake git runs on Windows too).
- [x] Given `find ~/<project>/.coding-flow -delete` with `~` the project's
      parent, then the guard denies it as it denies the `rm`.
- [x] Given the PR CI, then `test (windows-latest, 22.x)` and every other job
      are green.

## Acceptance Traceability

1. test/windows-paths.test.js::a Git Bash path is read as the Windows path it names, on Windows only — test/windows-paths.test.js::a script handed to bash -c is read with the platform of the command around it
2. test/guard-destructive.test.js::git switch in the primary checkout is refused when primaryLocked (the shell form is exercised for real on the Windows CI job)
3. test/harness-fixers.test.js::a fixer with its own time limit is killed at it (the marker check runs on the Windows CI job) — test/windows-paths.test.js::a timed-out command on Windows kills only what it started, found by parent id and creation time — test/windows-paths.test.js::a process naming the dead shell as parent but created after the shell died is not its child, nor are its children — test/windows-paths.test.js::a command whose output overflows has its tree killed, with the window it ran in — test/windows-paths.test.js::a shell child stamped a clock tick before the command started is still its child; one stamped beyond the tolerance is not — test/windows-paths.test.js::a shell child stamped a clock tick after spawnSync returned is still its child; one stamped beyond the tolerance is not — test/windows-paths.test.js::what a killed process started between the listing and the kill is killed by a second pass
4. test/harness-fixers.test.js::a guard log cut otherwise than the guard trims it is a forbidden write
5. test/guard-destructive.test.js::S3-2: after one git timeout, the other git lookups of the same decision are skipped (Windows CI)
6. test/guard-destructive.test.js::find START -delete reaches the policy file through ~, as rm does
7. Windows CI run on the draft PR (recorded in Result)

## Commands

```bash
npm test
```

## Result

- **Final (2026-11-25, HEAD after d94c8c7):** review rounds 4 and 5 PASS (STRICT, two lenses). `ai-flow verify --story` green (evidence `.coding-flow/runs/2026-11-25T17-15-51-650Z-verify.json`, coverage 98.3%). The Windows proof of criteria 2–5 and 7 is the required `windows-latest` job of the story's PR into `develop`: GitHub merges only when it is green.
- Earlier history:

- Linux: `npm test` passed (1969 passed, 0 failed, 2 TODOs owned by story 26-08).
  `ai-flow verify --story` passed on the story merged with develop (19-10
  included); evidence is in `.coding-flow/runs/2026-11-25T03-50-51-753Z-verify.json`.
- Draft PR #62 (CI only, not to be merged):
  - Run 45543675335: the six failures from PR #61 were fixed. One new
    failure appeared ("readDestructive is pure", `/x` is a drive) and was
    fixed in ec6efd3.
  - Run 45547651944: every job passed — ubuntu 18/20/22, macOS 22 and
    **windows-latest 22.x** (30 min 32 s), at a HEAD before the review
    round-1 and round-2 fixes; it does not prove them.
    https://github.com/LandryPouth/coding-flow/actions/runs/45547651944
  - Windows run at the round-2 HEAD: pending (to be recorded after CI).
