# Story 04-03 — Tasks

- [x] Read `scoreDiffRisk`/`defaultHighRiskPaths`/`matchesPattern`
      (`harness.js`) (targeted discovery — extend, do not restructure).
- [x] Add a structural-signal pass to `scoreDiffRisk` (unconditional
      `git worktree remove`/`git branch -D`/unattended merge), with unit
      tests including a false-positive guard on an already-`allowFail`-guarded
      call.
- [x] Write `scripts/check-lock-exit-reachability.js` (dependency-free),
      scoped to this project's `withFileLock`/`fail()` convention.
- [x] Add a regression fixture reproducing `landCleanup`'s pre-fix shape;
      confirm the check fails red on it and passes clean on the current,
      fixed `worktree.js`.
- [x] Declare the script in `.coding-flow/config.json`'s
      `validation.quality`.
- [x] Update `docs/DOGFOODING.md`'s 2026-08-28 row `Resolution`.
- [x] Run `npm test`; capture the verify.

## Status: done

## Result

`scoreDiffRisk` (`bin/lib/harness.js`) now takes an optional `root` parameter
(default `cwd`, matching this file's own `harnessConfigPath`-style convention)
and, alongside its existing path-pattern matching, scans each changed
non-test/non-doc `.js`/`.ts` file's *added* lines (`git diff -U0` against the
same merge-base `changedFilesForCoverage` already resolves, falling back to
reading untracked files whole) for four structural signals: `git worktree
remove`, `git branch -D`/`-f`, `git merge`, `git reset --hard`. A match is
skipped if `allowFail: true` appears within a 3-line window after it (this
project's own guarded-call convention) — only an unconditional, unguarded
mutation call escalates, to `high`, with the reason naming the specific
signal and file (mirroring the existing `matchedPaths` reason shape). The two
call sites scoring a worktree other than the process's own (`worktree-plan.js`
`chainIsFinished`, `status.js`'s `diffRiskForRoot`) now pass their own
root/cwd through explicitly; the other two (`buildHarnessPreflight`,
`evaluateCoverageResult`) already ran at the module's own `cwd` and needed no
change.

`scripts/check-lock-exit-reachability.js` is a new, dependency-free static
check: it finds every `withFileLock(...)` callback in a file, finds which
same-file, named helper functions that callback calls, and flags any `git(`
call inside those helper bodies that lacks `allowFail: true` nearby and no
`// lock-exit-ok: <reason>` suppression comment — the exact shape of the real
bug story-03-02's sixth review pass found in `landCleanup`. Comments and
string contents are neutralized (space-blanked, same length/line numbers) via
`blankCommentsAndStrings` before any structural regex runs, so this
heavily-commented codebase's own prose mentions of `git()`/helper names by
name do not read as real calls — an early, naive version of the check
false-flagged exactly that (see Decisions below).

Deliberately scoped to a NAMED helper function called from the lock callback,
not to code written directly, inline, inside the callback's own text — see
Decisions.

### Independent Review

An adversarial `/flow-review` pass (required by story-04-02's own STRICT gate,
since this story's diff itself scores `high` under the signal it adds) found
and reproduced two HIGH-severity soundness bugs, plus one MEDIUM, all fixed
before landing:

- **Guard leak across adjacent calls** — `isGuardedWindow` tested
  `allowFail: true` against the whole 3-line scan window, so a guarded call
  and an unguarded call on the same line/window contaminated each other; the
  unguarded one went undetected. Fixed by scoping the guard check to the
  specific call's own balanced-parens span (`callSpanText`), not the window.
- **Rename false positive** — `addedLinesByFile` restricted its `git diff`
  call to a pathspec of only the new filenames, which hides the old side from
  git's own rename detection: a content-unchanged rename of a file already on
  the default branch showed as 100%-added, re-flagging pre-existing,
  already-reviewed code as new. Fixed by running the diff unrestricted and
  filtering to the candidate files in-process, pre-registering every file
  named in a `diff --git` header (even a content-identical rename, which
  emits no `+++`/`+` lines) so it no longer falls through to the
  whole-file-as-added fallback.
- **Regex-literal misread as a comment** — `blankCommentsAndStrings` had no
  regex-literal awareness: a pattern ending in an escaped-slash immediately
  before its closing delimiter (e.g. `worktree.js`'s own now-fixed neighbor,
  `ship.js`'s `/^ssh:\/\/git@github\.com\//i`) reads as `//`, blanking the
  rest of that physical line as a comment — silently erasing any unguarded
  call written on the same line. Fixed with a standard division-vs-regex
  lookbehind heuristic (`isRegexContext`) plus a balanced, escape/character
  -class-aware regex-literal scanner (`regexLiteralEnd`), each verified
  against the real `ship.js` pattern.

Also, in response to the review surfacing it again: the two inline, unguarded
`git()` calls in `worktreeLand` (`rev-parse HEAD`, `reset --hard`) — already a
documented, deliberate scope exclusion (see plan.md Decisions) — now each
carry an explicit `// lock-exit-ok:` comment at the call site, so the
exception is visible in the code itself, not only in plan.md.

All three fixes have dedicated regression tests (`test/harness-risk.test.js`,
`test/check-lock-exit-reachability.test.js`); full suite: 591/591 passing.

### Rollback Notes

`git revert` is sufficient: the new `validation.quality` entry is additive
(one more declared command), the `scoreDiffRisk` signature change is
backward-compatible (`root` defaults to the prior implicit behavior), and no
existing file's runtime behavior changed. No migration, no data, no
feature-flag path.

