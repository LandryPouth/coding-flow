# Plan — Story 02-02

## Implementation Context

- **Execution mode**: STRICT — real git history operations (merge, rebase);
  a mistake here can lose commits or produce a wrong merge silently.
- **Scout pre-step**: yes — re-read `worktreeRemove`'s dirty-check and
  cleanup sequence and `ship.js`'s `epicCompleteness` before writing `land`,
  so the new code matches established patterns instead of inventing
  parallel ones.
- **Likely files**:
  - `bin/lib/worktree.js` — new `worktreeLand(name, { story, cwd })` plus a
    `land` branch in `worktreeCommand`'s dispatcher. Reuse: `parseWorktrees`
    / the same lookup chain `worktreeRemove` uses (`:363-368`),
    `realDirtyLines` (`:334-342`, currently private to the dirty check —
    reusable as-is, no export needed if `land` lives in the same file),
    `removeManagedLinks` + the `git worktree remove`/`prune` sequence
    (`:404-413`).
  - `bin/lib/audit.js` — `latestVerifyByStoryDir` (`:322-341`, already
    exported and already used by `ship.js`) and `isStale`/`gate`
    (`:288-313`) for the stale-proof check.
  - `bin/lib/identity.js` — `computeTreeToken(cwd)` (`:83-98`, exported) to
    get the story worktree's current token to compare against the recorded
    `treeToken`.
  - `bin/lib/worktree.js`'s own `unlock` path from `story-02-01` — call it
    (or the function directly, whichever is cleaner in the finished
    `story-02-01` code) as the last cleanup step.

## Technical notes

- **Why this is stricter than `ship.js`'s `epicCompleteness`.** That
  function only checks `entry.ok === true`, no staleness — acceptable there
  because it is gating a PR the human reviews anyway. `land` merges
  unattended-ish, so it should match `audit.js`'s own `gate()` semantics
  (`ok && treeToken matches current`) rather than the weaker check. Do not
  "fix" this by loosening `land`'s check to match `ship.js` — the
  discrepancy is intentional, not a bug to reconcile.
- **ff-only first, rebase only on divergence, never a merge commit by
  default.** `git merge --ff-only <branch>` from the target checkout either
  succeeds cleanly or fails fast with no side effects — safe to attempt
  unconditionally as the first move. Only fall back to rebase when it fails.
- **Rebase happens in the story's own worktree, not the target's.** `git
  rebase <target-branch>` run with `cwd` set to the story worktree path —
  this replays the story's commits without touching the target checkout at
  all until the retried `ff-only` merge. If the rebase leaves the story
  worktree mid-conflict, `land` must exit without touching the target
  branch — the target stays exactly as it was before `land` ran.
- **Detecting a real rebase conflict vs. success**: check the rebase
  command's exit code and `git status` (`UU`/unmerged markers) the same way
  `realDirtyLines`/`git status --porcelain` are already parsed elsewhere in
  this file — do not shell out to a different conflict-detection mechanism.
- **"Already landed" (target has nothing new from the story)**: `git
  merge-base --is-ancestor <story-branch> <target>` before attempting
  anything — if true, skip straight to cleanup and report it, per the
  spec's edge case.

## Decisions

_(filled during implementation)_

## Test plan

- `test/worktree.test.js`, a `land` section: ff-only success (linear
  history, worktree/branch/lock cleaned up), divergent-branch rebase
  success, real conflict during rebase (target untouched, worktree left
  mid-rebase, nothing cleaned up), dirty story worktree refused, run-from-
  wrong-checkout refused, no-verify refused, stale-verify refused,
  already-landed short-circuit.
- Build these against real temp git repos the same way `test/worktree.test.js`
  already sets up fixtures for `add`/`remove` — do not mock `git`.

## Acceptance traceability

| Criterion | Test |
|---|---|
| dirty worktree refused | `test/worktree.test.js` |
| wrong-checkout refused | `test/worktree.test.js` |
| no verify refused | `test/worktree.test.js` |
| stale verify refused | `test/worktree.test.js` |
| ff-only success + cleanup | `test/worktree.test.js` |
| divergent rebase success + cleanup | `test/worktree.test.js` |
| real conflict stops cleanly, target untouched | `test/worktree.test.js` |
| linear history when ff-only was possible | `test/worktree.test.js` |

## Commands

```
npm test
```
