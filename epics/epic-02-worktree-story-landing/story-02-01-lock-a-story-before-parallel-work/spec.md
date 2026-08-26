# Story 02-01 — Lock a story before parallel work

## User value

Starting a second `/flow-run` on a checkout that already has another story's
unfinished work in it is refused, with a message that says exactly what to do
instead — before any file gets touched, not after two stories' diffs are
already mixed on disk.

## Requirements

- A new command pair on the existing `worktree` dispatcher
  (`bin/lib/worktree.js`'s `worktreeCommand`, alongside `add`/`list`/`remove`):
  `ai-flow worktree lock --story <dir>` and
  `ai-flow worktree unlock [--story <dir>]`.
- The lock is a single JSON file at `.coding-flow/active-story.json`
  (`{ story: "<portable story-dir path>", startedAt: "<ISO timestamp>" }`),
  scoped to the checkout it is written in — a worktree created by
  `ai-flow worktree add` gets its own copy of `.coding-flow/`, so the lock
  is naturally per-checkout with no extra plumbing.
- `lock --story <dir>`:
  - No lock present → write it, exit 0.
  - Lock present for the **same** story (path match) → no-op, exit 0 (a
    resumed session re-locking its own story is not a conflict).
  - Lock present for a **different** story → refuse (non-zero exit), message
    names the locked story and points at
    `ai-flow worktree add --story <dir>` as the way forward.
- `unlock [--story <dir>]`: removes the lock. If `--story` is given and does
  not match the recorded lock, refuse rather than clearing someone else's
  lock silently. Also accepts `--force` to clear an unmatched or stale lock
  explicitly (crash/abandoned-session recovery — mirrors `worktree remove
  --force`'s existing escape-hatch pattern, never a silent auto-expiry).
- `.coding-flow/active-story.json` must never be committed: it is runtime
  state, not proof, unlike `config.json`, which is tracked (`runs/*.json` is
  already gitignored today — the same treatment this file needs). `lock`
  ensures the repo's root `.gitignore` has an entry for it the same way it is
  absent today — idempotently, touching nothing if the line is already
  present.
- `skills/flow-run/SKILL.md` calls `ai-flow worktree lock --story <story-dir>`
  before any implementation, at every intensity (QUICK through STRICT) — not
  gated behind the existing "STRICT only" `harness preflight` step, since the
  risk this defends against does not correlate with story risk tier. If the
  lock refuses, the skill stops and isolates first rather than proceeding.
- The skill calls `ai-flow worktree unlock --story <story-dir>` exactly once,
  at the point it writes `## Status: done` after a captured green verify — not
  on `blocked` or `in-progress`, since a blocked story still has real unlanded
  work that the lock is correctly protecting.

## Acceptance criteria

- [x] Given no lock file exists, when `ai-flow worktree lock --story <dir>`
      runs, then `.coding-flow/active-story.json` is created with that
      story's path and a timestamp, and the command exits 0.
- [x] Given a lock already exists for story A, when `ai-flow worktree lock
      --story <A>` runs again for the same story, then it exits 0 and the
      file is unchanged (no conflict for a resumed session).
- [x] Given a lock exists for story A, when `ai-flow worktree lock --story
      <B>` runs for a different story, then it exits non-zero, the lock file
      is untouched, and the message names story A and suggests `ai-flow
      worktree add --story <B>`.
- [x] Given a lock exists for story A, when `ai-flow worktree unlock --story
      <A>` runs, then the lock file is removed and the command exits 0.
- [x] Given a lock exists for story A, when `ai-flow worktree unlock --story
      <B>` runs (mismatched story, no `--force`), then it exits non-zero and
      the lock file is untouched.
- [x] Given a lock exists for story A, when `ai-flow worktree unlock
      --force` runs with no `--story`, then the lock file is removed
      regardless of which story it names.
- [x] Given a project's root `.gitignore` does not mention
      `.coding-flow/active-story.json`, when `ai-flow worktree lock` runs for
      the first time, then the line is appended and `git status` never shows
      the lock file as untracked afterward.
- [x] Given `.gitignore` already ignores `.coding-flow/active-story.json`
      (or a broader pattern that covers it), when `lock` runs, then
      `.gitignore` is left byte-for-byte unchanged.

## Edge cases

- **No `.gitignore` at all.** Create one containing just the lock-file line,
  same non-fatal spirit as `harness.js`'s existing `.gitignore` check
  (`missing_gitignore`, reported not fatal).
- **Run outside a git repo.** `requireRepo` already fails cleanly for every
  other `worktree` subcommand — `lock`/`unlock` behave the same way, no new
  error path to invent.
- **`--story` path outside the repository, or not a real story directory.**
  Reuse `resolveStory`'s existing validation (`worktree.js`) rather than
  writing a second check with different edges.
- **Two lock attempts racing on the exact same checkout.** Out of scope: the
  lock defends against the recorded incident (a second *session*, i.e. a
  human/agent, starting on an occupied checkout), not a filesystem-level
  race between two writes in the same process tick.

## Out of scope

- `ai-flow worktree land` and everything after it — `story-02-02`. This
  story only has to make the occupied-checkout case refuse cleanly; nothing
  here reconciles a finished worktree back onto the epic branch.
- Any change to how `ai-flow status` reports worktrees — `story-02-04`.
- Trusting or reading the epic backbone's dependency tree. The lock check
  never asks whether two stories are declared parallel-safe.
