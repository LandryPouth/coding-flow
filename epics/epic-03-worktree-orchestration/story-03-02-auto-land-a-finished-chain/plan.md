# Story 03-02 — Plan

## Implementation Context

- **Execution mode**: STRICT.
- **Scout pre-step**: no — builds directly on story-03-01's placement state
  and epic-02's existing `worktree land`; no new discovery needed beyond
  reading those two.
- **Likely files**:
  - `bin/lib/worktree.js` — call the existing `worktreeLand`/`landCleanup`
    functions (or the CLI entrypoint they back) as-is; add the
    `<repo>-worktrees/` parent-directory cleanup once a worktree is removed
    and the parent is empty (extend `landCleanup`, or wrap it —
    implementer's call).
  - Wherever story-03-01's placement decision and "verified" check happen
    (`skills/flow-run/SKILL.md`'s new placement step, or a small
    `bin/lib/*` module it calls) — this story adds a post-completion check:
    is this story its chain's last one, and is that chain in a worktree.
  - The placement-state module from story-03-01 — needs a "chain's last
    remaining story" query and a "clear this chain's recorded location"
    write.
- **Search anchors**: `landCleanup` in `worktree.js` (the exact sequence:
  unlock, remove managed links, `git worktree remove`, `git worktree prune`,
  delete branch — extend, do not restructure); `latestVerifyByStoryDir`/
  `isStale` in `audit.js` (the `verified` check `land` itself already
  performs before merging — reuse the same definition here for "is this
  story actually verified," don't redefine it).
- **Areas to avoid**: `worktree land`'s merge/rebase/conflict/re-verify
  internals (epic-02's contract, unchanged).

## Technical Notes

- "Chain's last not-yet-done story" is answered from the same dependency
  graph story-03-01 parses — no new graph logic here, only a query over it
  (does any other story on this chain have a status other than
  `done`/`verified`).
- The `<repo>-worktrees/` parent removal must check emptiness at the moment
  of removal (`fs.readdirSync` right before `fs.rmdir`), not rely on a count
  computed earlier in the same run, to avoid the race the spec's concurrency
  edge case describes.
- Auto-land reuses `worktree land`'s own preconditions (clean tree, green
  non-stale verify) unchanged — it does not redefine what makes a land
  succeed or fail. It does, however, actively keep one of those
  preconditions honest before calling `land`: `land`'s freshness check
  reads the verify recorded for the story matching the *worktree's own
  name*, which is always the chain's root, and the root's own recorded
  verify predates every dependent's later commits by construction in any
  real multi-story chain. Left unrefreshed, `land` would refuse every
  multi-story chain with "stale" even once `chainIsFinished` has correctly
  recognized it as done. `autoLandIfChainFinished` re-runs
  `ai-flow verify --story <root>` (the same command a human would run by
  hand) against the current tree immediately before calling `land`, only
  when the root's own recorded verify is missing or stale. That is **not**
  a rare, single-story-only case: `flow-run` always writes `## Status: done`
  as its own commit right after the verify it is based on (SKILL.md's
  "Status From Proof"), and that commit alone moves the tree past the
  verify's own recorded token — so the refresh fires on essentially every
  real land, single-story chains included, not only multi-story ones. See
  tasks.md's "Post-review fixes" entries for how this was found and
  corrected across two separate `/flow-review` passes (a `/flow-review`
  pass reproduced both the stale-root gate and a related bug in
  `chainIsFinished` itself against real single- and multi-story
  reproductions; a third pass then reproduced the refresh step itself
  crashing under this project's own `.gitignore`).
- That refresh's own evidence write is committed narrowly
  (`git add -- .coding-flow/runs`, never `-A`) so `land`'s own dirty-tree
  check does not itself refuse on an untracked evidence file — but only
  when `.coding-flow/runs/` is not already gitignored. When it is (this
  project's own root `.gitignore` has excluded it since day one, and
  nothing in this codebase's real verify path ever commits it —
  `harness.js`'s `writeVerifyEvidence` is pure disk I/O), `git status
  --porcelain` never lists the file as dirty in the first place, so there
  is nothing to stage and no commit is attempted (`git check-ignore`
  decides this upfront, before ever calling `git add`). A `/flow-review`
  pass found and reproduced the earlier version of this step crashing with
  an uncaught error on exactly that configuration — `git add` on an
  explicitly-named, fully-ignored path exits non-zero without `-f`, and
  since the refresh fires on nearly every real land (see above), that
  crash was not an edge case. The commit is also skipped when nothing is
  actually staged after the add (the rare case where `verify`'s own
  reusable-proof cache answered from an already-matching evidence file
  without writing a new one).
- `chainIsFinished` itself does not re-check freshness for any chain
  member, root or not: all of a chain's stories share one worktree/branch,
  and `flow-run` always writes `## Status: done` as its own commit right
  after the verify it is based on, for every story — so a static token
  comparison there would flag every finished chain as unfinished, always.
  This mirrors the same "done/verified status plus a verify that was green
  at some point" definition `next.js`'s own ready-to-ship tier already
  uses; freshness is enforced once, honestly, right before land, not
  duplicated (and gotten wrong) here.

## Decisions

- Auto-land failure (conflict or failed re-verify) is reported the same way
  a manually-run `land` reports it today — no new failure-summary format
  invented for the automatic path, so there is exactly one way `land`
  failure ever looks, whoever or whatever triggered it.
- The parent `<repo>-worktrees/` directory is removed on empty, not
  proactively kept around "in case another story needs it soon" —
  `worktree add` already recreates it via
  `fs.mkdirSync(..., { recursive: true })` the next time it is needed, so
  nothing is lost by removing it early.
- **`worktree land`'s mutating sequence is now serialized against the shared
  main checkout** (`/flow-review`, 2026-08-29 pass, found this unaddressed in
  the story's first draft — see spec.md's Concurrency edge case). The lock
  reuses `placement-store.js`'s own filesystem-lock primitive, extracted into
  a general `withFileLock(lockPath, fn, { waitTimeoutMs, staleMs })` so
  `worktree.js` did not need to reinvent wait/steal-if-stale semantics —
  scoped by `git-common-dir` (not `root`) so the same lock file applies
  regardless of which of the repo's worktrees a `land` call happens to run
  from. Two timeout knobs, not the placement store's own defaults: `land`'s
  critical section can run a real, unbounded project validation command
  (`verifyStoryOnce`), unlike the placement JSON's fast, bounded read+write —
  reusing the 5s/30s defaults would time out a legitimately still-running
  concurrent land, or steal its lock outright, well before it could
  plausibly be done. Chose 10 minutes to wait, 15 minutes before a held lock
  is considered abandoned; both are generous rather than tuned, since a
  wrong-but-safe direction (waiting/retrying a bit long) costs far less than
  a wrong-but-unsafe one (racing the checkout again).
  Getting this right required tracing `fail()`'s own `process.exit()` first:
  confirmed directly (a small standalone repro) that `process.exit()`
  terminates before any `finally` already on the call stack runs — including
  `withFileLock`'s own, which releases the lock. `land` calls `fail()` on
  nearly every one of its own failure paths (a conflict, a stale verify, a
  failed re-verify), so wrapping those calls in the lock unchanged would have
  leaked it on the COMMON case, not a rare one — the very next `land` retry
  (the normal, expected recovery this suite already tests: "retried after a
  rollback, lands cleanly") would then wait out the full 10-minute timeout
  for nothing. Fixed by converting every `fail()` call inside the locked
  section to a thrown `Error` instead — a real exception unwinds the stack
  normally, so `withFileLock`'s `finally` runs and releases the lock before
  the error ever reaches the caller — with a single `try/catch` around the
  whole `withFileLock(...)` call translating back to `fail(err.message)`
  once the lock is already free, so the reported failure text is unchanged
  for every existing test. Two calls inside the locked section still go
  through the shared `git()` helper's own default (non-`allowFail`) path,
  which still calls `fail()` directly rather than throwing (`rev-parse HEAD`,
  and the post-failure `reset --hard`) — left as the ordinary `git()`
  contract on purpose rather than converted like every other mutating call
  here, since both only fail if git itself is broken on a repo already
  proven valid moments earlier; at that point a lock stuck for up to 15
  minutes is the least of the problem, and the stale-timeout reclaim still
  recovers it, just not immediately.
  Verified with a real regression test (`test/worktree.test.js`, "worktree
  land waits for the shared land lock instead of racing a concurrent
  holder"): a background OS process pre-acquires the exact lock file `land`
  now takes and holds it for a known duration, and the test asserts `land`
  waited at least that long rather than proceeding immediately. Confirmed red
  against the pre-fix code (temporarily reverted `worktree.js`/
  `placement-store.js`, kept the new test: failed with "waited 581ms, held
  800ms") before confirming it passes with the fix restored.

- **Sixth `/flow-review` pass (2026-08-29)** found the "two calls" inventory
  above was itself incomplete: `landCleanup` (called from both call sites
  inside the same locked section — the already-landed shortcut and the normal
  success path) made its own `git worktree remove`/`git worktree prune` calls
  through the shared `git()` helper's default (non-`allowFail`) path, which
  also calls `fail()` → `process.exit()`. Reproduced directly (a validation
  command that drops a stray, unmanaged file into the story worktree during
  the post-merge re-verify — after the pre-lock dirty check already passed
  clean, so this is a real race window, not a contrived one): `git worktree
  remove` then refuses ("contains modified or untracked files"), `fail()`
  fires from inside `withFileLock`'s callback, and the lock file is left on
  disk — confirmed with a standalone script showing the lock survives the
  process exit. Every later `land` (including a concurrent auto-land from
  another chain, exactly what this lock exists to protect) would then wait
  out the full 10-minute timeout before the 15-minute stale-reclaim frees it.
  Fixed the same way as every other mutating call in this section:
  `{ allowFail: true }` plus a thrown `Error` naming what failed and making
  clear the merge itself already succeeded (so retrying `land` is safe — it
  will take the already-landed shortcut). The "two calls" inventory above is
  accurate again now that `landCleanup`'s two calls are converted alongside
  it.
  New test: `test/worktree.test.js`, "worktree land releases the shared lock
  instead of leaking it when landCleanup's worktree removal fails" — confirmed
  red against the pre-fix code (temporarily reverted `worktree.js`, kept the
  new test: the lock file was left on disk) before confirming it passes, and
  releases the lock, with the fix restored. `npm test`: 548/548 (was 547/547
  — one new test, no regressions).

- **Seventh `/flow-review` pass (2026-08-29)** found that `withFileLock`
  itself (`bin/lib/placement-store.js`) had no notion of lock ownership: its
  release (`finally { ...; fs.rmSync(lockPath, { force: true }); }`) deleted
  whatever file currently sat at `lockPath`, unconditionally. No `staleMs`,
  however generous, actually eliminates the steal race described above it —
  it only makes it less likely: holder A acquires and runs past `staleMs`
  (still alive, not crashed); holder B, waiting since before A crossed that
  threshold, reclaims the now-stale-looking lock and starts its own critical
  section; when A eventually finishes, A's own unconditional `rmSync` deletes
  B's still-active lock file, not A's own (already-replaced) one — freeing
  the lock for a third caller to acquire while B is still mid-`land`. This is
  the exact interleaving this story's whole lock exists to prevent (spec.md's
  Concurrency edge case), reachable specifically when `land`'s real,
  unbounded validation command runs long enough to cross
  `LAND_LOCK_STALE_MS` (15 minutes) — a real, if narrow, scenario for a slow
  project suite, not a contrived one.
  Fixed by giving each acquisition an ownership token: a random string
  written into the lock file right after `openSync("wx")` succeeds, checked
  back on release — `rmSync` only runs if the file still holds that same
  token, so a holder that has already been superseded skips the delete
  instead of destroying the new owner's lock. The existing stale-reclaim path
  (steal, then loop back to re-open and write a fresh token) is unchanged;
  only the release side gained the check.
  New test: `test/placement-store.test.js`, "withFileLock does not delete a
  lock stolen from it while it was still (slowly) running" — a background
  process acquires the lock, backdates its own lock file past a short
  `staleMs` (simulating a holder that is still working but looks abandoned),
  and sleeps; the foreground call steals the now-stale-looking lock while the
  background holder is still asleep, then blocks until the background holder
  wakes up and runs its own release, then asserts its own lock file is still
  there with its own content. Confirmed red against the pre-fix code
  (temporarily reverted `placement-store.js`, kept the new test: the
  foreground call's lock was deleted out from under it) before confirming it
  passes with the fix restored. `npm test`: 549/549 (was 548/548 — one new
  test, no regressions).

- **Eighth `/flow-review` pass (2026-08-29)** found that the Seventh pass's
  ownership token only closed half the gap it described: it stops a stolen
  lock's original holder from deleting the new owner's lock file, but does
  nothing about the theft itself — a holder that is still genuinely alive and
  working can still have its lock stolen once `LAND_LOCK_STALE_MS` (15
  minutes) elapses, at which point the thief runs its own merge/rebase/reset
  concurrently against the same shared checkout the original holder is still
  using. Traced against `harness.js`'s own defaults rather than treated as an
  already-acceptable edge case: `verifyStoryOnce`'s validation commands run
  SEQUENTIALLY (`results = resolution.commands.map(...)`), each individually
  capped at `runValidationCommand`'s default `timeoutMs` of 600000ms (10
  minutes), with no cap on how many commands a project's
  `config.validation.commands`/`quality` declares. A project with as few as 2
  ordinary commands can legitimately run past the fixed 15-minute `staleMs`
  with nothing individually near its own per-command cap — not a contrived
  extreme, an unremarkable multi-command validation config. At that point a
  second auto-land arriving even a few minutes after the first (well inside
  "two chains finishing near the same moment", spec.md's own scenario) steals
  the lock instead of waiting, exactly the interleaving this lock exists to
  prevent.
  Fixed by deriving both lock timeouts from the project's own configured
  validation-command count instead of a fixed guess: `landLockTimeouts`
  (`bin/lib/worktree.js`) takes the count `resolveValidationCommands({
  storyDir: null })` reports (the same resolution `land`'s own re-verify call
  uses) and returns `max(fixed floor, commandCount * 600000 + margin)` for
  both `waitTimeoutMs` and `staleMs` — so a project whose real worst case
  exceeds the old fixed constants gets timeouts that actually cover it,
  while a project with few or no configured commands keeps exactly the
  previous 10-minute/15-minute behavior. The command-count lookup is
  best-effort (an unreadable config falls back to the fixed floors rather
  than blocking land over it); the timeout arithmetic itself is a pure
  function of a plain number, kept separate and exported so it is
  unit-testable without a real project checkout.
  New tests: `test/worktree.test.js`, "landLockTimeouts scales both timeouts
  with the number of validation commands, never below the fixed floors" (unit
  test on the pure function) and "worktree land does not steal a lock aged
  past the fixed stale floor when the project declares enough validation
  commands to legitimately need longer" (a lock backdated 16 minutes — past
  the OLD fixed 15-minute `staleMs` — held by a background process for 800ms,
  against a repo configured with 3 validation commands; confirmed red against
  the pre-fix code, temporarily reverted to the fixed constants: `land` stole
  the backdated lock immediately, waiting only ~605ms instead of the full
  800ms, before confirming it waits for the real release with the fix
  restored). `npm test`: 551/551 (was 549/549 — two new tests, no
  regressions).
  Residual: this narrows the gap to "a validation suite whose real,
  configured worst case still exceeds its own derived `staleMs`" (only
  possible now if a single command's actual runtime is close to but under its
  10-minute timeout by design and the project's true worst case is
  underestimated by the fixed per-command constant) rather than eliminating
  it outright — a true heartbeat (refreshing the lock file's mtime while the
  critical section is still running, regardless of command count) would close
  that too, but requires a background process independent of the parent's own
  blocking `execFileSync` calls, which is real added complexity deferred for
  now given the derived-timeout fix already covers the realistic case this
  story's acceptance criteria describe.

## Test Plan

- Extend `worktree.test.js`'s existing real-temp-git-repo pattern: a
  two-story chain in its own worktree reaching `verified` on its last story
  triggers land + directory removal; a sibling worktree untouched when only
  one of two chains lands; the empty-parent-directory removal, and the case
  where it is *not* removed because a sibling worktree remains; the
  rollback-on-failed-re-verify path leaves the worktree/branch/placement
  state untouched, matching epic-02's existing guarantee.

## Acceptance Traceability

| Criterion | Test |
|---|---|
| Last story of a worktree'd chain triggers land + directory removal | `test/worktree.test.js` — auto-land, single chain |
| Empty parent `<repo>-worktrees/` removed | same file — parent cleanup |
| Sibling worktree untouched when only one chain lands | same file — parent cleanup, non-empty case |
| Failed post-land re-verify rolls back, is reported | same file — auto-land, rollback case |
| Not-yet-done sibling in the same chain blocks the land | same file — no-op case |
| Chain never isolated in a worktree: no-op on completion | same file — no-op, primary-checkout case |

## Commands

```bash
npm test
```
