# Story 02-03 — Verify and roll back a landed story

## User value

A land that combines two independently-green stories into something broken
— the concrete worry: two Prisma migrations that never conflict as text but
are incompatible once applied together — is caught immediately, and the
epic branch is put back exactly as it was before the land ran, instead of
sitting broken until someone notices.

## Requirements

1. After `story-02-02`'s merge succeeds (fast-forward or post-rebase
   fast-forward) and **before** the worktree/branch/lock cleanup it
   currently runs immediately, always re-run the project's validation
   commands (`resolveValidationCommands` from `bin/lib/harness.js` — the
   same source `ai-flow verify` already reads: `.coding-flow/config.json`'s
   `validation.commands`/`validation.quality`) against the **target
   branch's checkout**, not the story's own worktree.
2. This re-verify is unconditional — it runs for every land, regardless of
   the story's own execution-mode tier (QUICK through STRICT). The risk it
   catches lives in the *combination* of two stories, which no single
   story's own risk tier reflects.
3. On a green re-verify: proceed to the cleanup `story-02-02` already
   implements (remove story worktree/branch, clear lock) — unchanged from
   that story, just moved to run after this check instead of immediately
   after the merge.
4. On a red re-verify:
   - `git reset --hard` the target branch back to the exact commit it was
     at before `land`'s merge — the single commit `land` itself just
     created (a fast-forward moves the branch pointer with no merge commit
     of its own to revert; record the pre-merge SHA before merging so the
     reset target is exact either way).
   - Do **not** touch the story's own worktree, its branch, or its lock —
     all three stay exactly as they were, so the fix happens where the
     story's own commits already live and `land` can be retried once it is
     fixed.
   - Report which validation command failed and its output, the same way
     `ai-flow verify` already reports a failing command — this is not a new
     failure format to invent.
   - Record this outcome as evidence (a `*-verify.json`-shaped run, or an
     equivalent entry `ai-flow audit` already knows how to read) so the
     failed land is not just a terminal message that vanishes — it should
     show up in `ai-flow status`/`ai-flow report` the same way any other
     captured verify does.

## Acceptance criteria

- [ ] Given a land whose merge succeeds and whose post-land validation
      commands all pass, when `land` finishes, then the target branch
      contains the story's commits, the story worktree/branch/lock are
      cleaned up, and a green evidence entry exists for the re-verify.
- [ ] Given a land whose merge succeeds but a post-land validation command
      fails, when `land` finishes, then the target branch is back at its
      exact pre-merge commit, the story's worktree/branch/lock are
      untouched, and the failure (command + output) is reported to the
      caller.
- [ ] Given that same rollback case, when `ai-flow status` or `ai-flow
      audit` runs afterward, then the failed land shows up as recorded
      evidence, not silently.
- [ ] Given the rollback has happened, when the story worktree is fixed and
      `ai-flow worktree land <name>` is run again, then it proceeds exactly
      as a fresh land would — the earlier failed attempt does not block a
      retry.
- [ ] Given a story whose own execution mode was QUICK, when it lands and
      the post-land validation fails, then the rollback still happens —
      confirming the re-verify is not gated by the story's own risk tier.

## Edge cases

- **`validation.commands` is empty (project declared none).** Mirror
  whatever `ai-flow verify` already does in that case (check `harness.js`'s
  existing empty-declaration handling) rather than inventing a different
  "nothing to check" behavior for `land` specifically.
- **The re-verify itself cannot run** (a tool error, not a red command —
  same distinction `flow-run`'s `SKILL.md` already draws for `ai-flow
  verify`). Treat this as a failure to trust the merge, and roll back —
  "could not confirm" is not "confirmed good."
- **Reset races with something else writing to the target branch
  concurrently.** Out of scope, same reasoning as story-02-01's race-
  condition edge case: `land` defends against the recorded incident, not
  against two processes mutating one branch in the same instant.

## Out of scope

- `ai-flow status` surfacing landable/landed/active worktrees —
  `story-02-04`.
- Retrying automatically after a rollback. `land` reports and stops; running
  it again is an explicit, separate action.
