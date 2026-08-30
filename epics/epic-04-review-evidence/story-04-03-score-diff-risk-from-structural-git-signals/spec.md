# Story 04-03 — Score diff risk from structural git signals

## User Value

A diff that deletes worktrees, force-deletes branches, or merges unattended
scores at least `medium`/`high` risk — the same STRICT territory the epic-03
rationale already names as risky — instead of `low`/`not-required` just
because none of those operations happen to spell "auth," "payment," or
"migration." And the exact bug class that took the most `/flow-review` passes
to find on story-03-02 (a `fail()`/`process.exit()` reachable from inside a
`withFileLock`-style locked callback) becomes a `verify`-time, near-zero-cost
deterministic check instead of something only a review pass can catch.

## Requirements

- Extend `scoreDiffRisk` (`bin/lib/harness.js`) with structural signals
  alongside its existing path-pattern matching: detect additions of
  unconditional git-mutation calls in changed, non-test files —
  `git worktree remove`, `git branch -D`/`-f`, an unattended `git merge`/
  `git reset --hard` outside of what an existing test already exercises.
  Matched structural signals raise the diff's own risk the same way a
  matched sensitive path already does (at least `medium`, `high` when the
  pattern is unconditional/unattended), and the reason string names the
  specific signal, mirroring the existing `matchedPaths` reason shape.
- Ship one concrete `config.validation.quality` check (a small, dependency-free
  script, matching this project's own zero-dependency constraint) that scans
  changed/tracked files for a callback passed to a lock-like helper (scoped to
  this project's own `withFileLock` convention) whose body can reach a
  `fail()`/`process.exit()`-calling helper without an intervening `try`/throw
  boundary — the exact shape story-03-02's sixth `/flow-review` pass found by
  hand in `landCleanup`. Declared in this project's own `.coding-flow/config.json`
  under `validation.quality`, so it runs inside `ai-flow verify` like any other
  declared check.
- Update the 2026-08-28 `docs/DOGFOODING.md` row's `Resolution` once done.

## Acceptance Criteria

- [x] Given a diff that adds an unconditional `git worktree remove`/
      `git branch -D`/unattended-merge call with no accompanying test
      touching it, when `scoreDiffRisk` runs, then it reports at least
      `medium` and names the structural signal in its reason — not `low`.
- [x] Given `ai-flow verify` runs on this repository with the new
      `validation.quality` entry configured, when a callback passed to
      `withFileLock` contains a path reaching `fail()`/`process.exit()`
      without an intervening throw/catch boundary, then the check exits
      non-zero and `verify` reports it as a failed command.
- [x] Given a regression fixture reproducing `landCleanup`'s pre-fix shape
      (the exact bug story-03-02's sixth pass found), when the check runs
      against it, then it fails — confirming the check actually catches the
      real bug class, not a synthetic stand-in.
- [x] Given the current, already-fixed `worktree.js` (post story-03-02, every
      mutating call inside the lock converted to `allowFail` + `throw`), when
      the same check runs, then it passes clean — no false positive on the
      converted calls.
- [x] Given a diff that only touches test files or docs, when `scoreDiffRisk`
      runs, then the new structural signals do not fire — no false escalation
      on non-production changes.

## Edge Cases

- **Correctness**: a git-mutation call already guarded by `{ allowFail: true }`
  followed by an explicit `throw`/error check (this project's own converted
  pattern, post story-03-02) must not be flagged — the check targets
  *unconditional* mutation and *unguarded* lock-then-exit reachability
  specifically, not every git call.
- **Security**: none new — this is a risk-scoring and static-check addition,
  not a change to what runs or who can trigger it.
- **UX**: `scoreDiffRisk`'s reason string for a structural match must be as
  legible as the existing path-based one (names the file and the specific
  operation, not just "structural risk detected").
- **Data**: the deterministic check must run offline, with no network access
  and no dependency beyond Node's built-ins, matching `worktree.js`'s own
  stated project constraint ("zero dependencies... Node's built-in modules").

## Out of Scope

- A general, project-agnostic static-analysis engine — the check is scoped to
  this project's own `withFileLock`/`fail()` naming convention, documented as
  a pattern other projects can copy and adapt, not a universal linter.
- Gating anything on `scoreDiffRisk`'s output beyond what already reads it
  today (`buildHarnessPreflight`'s recommended mode, and, after story-04-02
  ships, the STRICT review requirement) — this story only makes the signal
  itself more honest.
