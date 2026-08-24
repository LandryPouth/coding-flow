# Plan — Story 02-01

## Implementation Context

- **Execution mode**: STANDARD — new state file and a new gate wired into
  every `/flow-run` invocation, but no destructive git operation and no
  privileged/data path.
- **Scout pre-step**: no — the exact anchors are already known (below).
- **Likely files**:
  - `bin/lib/worktree.js` — add `worktreeLock`/`worktreeUnlock` functions and
    two branches in `worktreeCommand`'s dispatcher (currently `add`/`list
    |ls`/`remove|rm`, ends around line 448-455). Reuse `resolveStory` (already
    validates `--story` the same way `add` does), `requireRepo`, `log`/`fail`.
  - `bin/ai-flow.js` — **no change expected**: the `worktree` branch
    (`:395-403`) already forwards `--story`/`--force` to `worktreeCommand`;
    `lock`/`unlock` are just new values of `commandArgs[0]`.
  - `bin/lib/harness.js:477-500` — existing `.gitignore` check
    (`missing_gitignore` / unignored `.env` pattern) is the model to mirror
    for appending the lock-file line; do not duplicate its logic, factor the
    idempotent-append into a small helper `worktree.js` can call, or export
    one from `harness.js` if that reads cleaner in the actual code.
  - `skills/flow-run/SKILL.md` — two edits: a new bullet in "## Harness
    Automation" (before the "Everything else is machinery, and scales with
    intensity" list, `:82`) requiring `ai-flow worktree lock --story
    <story-dir>` before any implementation at every intensity; and, in
    "## Status From Proof" (`:102-116`), pair `## Status: done` with `ai-flow
    worktree unlock --story <story-dir>`.

## Technical notes

- Lock file shape: `{ "story": "<portable path, same format resolveStory
  already produces via `linkedStory.rel`>", "startedAt": "<ISO 8601>" }`.
  Written with the same `writeJson`-style helper other lib modules use
  (check `bin/lib/util.js` for an existing `writeJson` before adding a new
  one — `run.js` already imports one).
- Same-story re-lock is a no-op by design (resumed sessions), matched on the
  `story` field only — do not also compare `startedAt` or try to detect
  "is the previous session still alive." That question is explicitly out of
  scope (see spec's race-condition edge case).
- `.gitignore` append: read the file (or treat absent as empty), check
  whether the exact line `.coding-flow/active-story.json` is already present
  (a broader pattern like `.coding-flow/` would also cover it — but per
  bethl's real config, `.coding-flow/` itself is intentionally tracked for
  its `runs/*.json` proof, so do not add a blanket `.coding-flow/` ignore;
  only the one specific file). Append with a trailing newline if missing.
- Keep `lock`/`unlock` symmetrical with `worktreeAdd`'s existing
  `--dry-run` support if that is cheap; not a hard requirement for this
  story if it adds real complexity — note the decision either way in
  `## Decisions` below once implemented.

## Decisions

- **No `--dry-run` for `lock`/`unlock`.** Both are single-file, single-branch
  decisions (write or refuse; delete or refuse) with no filesystem side
  effects to preview beyond the `.gitignore` append, which is itself
  idempotent and safe to just run. `add`'s `--dry-run` earns its keep because
  it previews a worktree creation, symlinks, and a possible `npm install` —
  none of that applies here.
- **`.gitignore` coverage check is not a full gitignore engine.** It only
  recognizes the exact line and the two `.coding-flow` directory-pattern
  shapes the story's acceptance criteria named. A pattern like `.co*-flow/`
  would not be recognized as covering the lock file and the line would be
  appended again — an unlikely gitignore style, and the failure mode (a
  harmless duplicate line) is cheap.
- **`ensureLockIgnored` runs on every `lock` call, including refusals and
  no-ops**, not only on a fresh write. It is idempotent and the invariant
  ("the lock file is always ignored once `lock` has ever run here") is
  simpler to reason about than conditioning it on which branch fired.

## Test plan

- `test/worktree.test.js` (existing) gains a `lock`/`unlock` section
  mirroring its existing `add`/`remove` coverage style: fresh lock succeeds,
  same-story re-lock is a no-op, cross-story lock is refused with the
  expected message, unlock removes the file, mismatched unlock without
  `--force` is refused, `--force` clears regardless.
- A `.gitignore`-append case: starting from no `.gitignore`, one that
  already ignores the exact line, and one missing it entirely.
- Extend or add a `test/flow-run-lock-wiring.test.js`-equivalent only if the
  skill instructions are the kind of thing this repo already tests
  elsewhere (check for a precedent, e.g. how `test/doctor-guard-wiring.test.js`
  tests wiring rather than prose, before deciding whether SKILL.md itself
  needs an assertion or just a careful read-through).

## Acceptance traceability

| Criterion | Test |
|---|---|
| fresh lock creates the file | `test/worktree.test.js` |
| same-story re-lock is a no-op | `test/worktree.test.js` |
| cross-story lock refuses, names the locked story | `test/worktree.test.js` |
| unlock removes a matching lock | `test/worktree.test.js` |
| mismatched unlock without `--force` refuses | `test/worktree.test.js` |
| `--force` unlock clears regardless | `test/worktree.test.js` |
| `.gitignore` gains the line exactly once | `test/worktree.test.js` |
| already-ignored `.gitignore` stays byte-for-byte unchanged | `test/worktree.test.js` |

## Commands

```
npm test
```
