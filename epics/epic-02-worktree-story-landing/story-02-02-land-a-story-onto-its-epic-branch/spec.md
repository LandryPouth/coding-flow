# Story 02-02 — Land a story onto its epic branch

## User value

A story finished and verified in its own worktree gets one command that
reconciles it back onto the branch the whole epic ships from — instead of
hand-rolled `git merge`/`rebase` surgery, which is exactly the kind of
manual git operation that produced the original incident this epic exists to
close (in miniature: a slip there corrupts one branch instead of one shared
checkout, but it is the same failure shape).

## Requirements

1. `ai-flow worktree land <name>` (also accepts `--story <dir>`, resolved the
   same way `add`/`remove` already resolve a name — the worktree is looked up
   by destination path, directory basename, or branch name).
2. Preconditions, checked before anything is written, each with its own clear
   refusal:
   - The story's worktree has no uncommitted changes (reuse the existing
     dirty-check `worktreeRemove` already uses).
   - `land` is not being run from inside the story's own worktree — it needs
     a distinct target checkout to merge into.
   - A green, non-stale verify is recorded for the story
     (`latestVerifyByStoryDir` + the tree-token staleness check `audit.js`'s
     `isStale`/`gate` already use elsewhere — see plan for why this is
     stricter than `ship.js`'s own completeness check, which checks `.ok`
     only).
3. Mechanism, cheapest option first:
   - Try `git merge --ff-only <story-branch>` from the checkout `land` runs
     in.
   - If that fails because the target moved since the story branched: rebase
     the story branch onto the target's current tip, **inside the story's
     own worktree**, then retry the fast-forward merge.
   - If the rebase hits a real conflict: stop immediately, report the
     conflicting files, leave the story worktree mid-rebase for manual
     resolution (`git rebase --abort` remains available). Never attempt
     automatic conflict resolution.
4. On a successful merge: remove the story's worktree and delete its branch
   (mirrors `worktree remove`'s existing cleanup, including its managed-link
   removal), and clear the story's lock (`ai-flow worktree unlock --story
   <dir>`, from `story-02-01`) if still present.
5. `land` never pushes anything and never opens or touches a PR — that stays
   `ship`'s job, unchanged.

## Acceptance criteria

- [ ] Given a story worktree with uncommitted changes, when `ai-flow
      worktree land <name>` runs, then it refuses, names the uncommitted
      files, and nothing is merged or removed.
- [ ] Given `land` is run from inside the story's own worktree, when it
      runs, then it refuses with a message naming the correct checkout to
      run it from instead.
- [ ] Given no green verify is recorded for the story, when `land` runs,
      then it refuses, names the story, and nothing is merged.
- [ ] Given a recorded verify is green but stale (the tree changed since),
      when `land` runs, then it refuses the same way as "no verify" and
      says the proof is stale.
- [ ] Given a clean, verified story worktree whose branch is a direct
      descendant of the target's current tip, when `land` runs, then a
      fast-forward merge lands it, the story worktree and branch are
      removed, and the lock file is cleared.
- [ ] Given a clean, verified story worktree whose branch diverged because
      the target moved, when `land` runs, then the story branch is rebased
      onto the new tip and fast-forward-merged, with the same cleanup as
      the direct case.
- [ ] Given a rebase in that divergent case hits a real conflict, when
      `land` runs, then it stops, reports the conflicting files, leaves the
      story worktree mid-rebase, and does not remove anything or clear the
      lock.
- [ ] Given `land` completes successfully, when the target branch's log is
      inspected, then it contains the story's commits and no separate merge
      commit was force-created when a fast-forward was possible (history
      stays linear in the common case).

## Edge cases

- **Worktree not found for `<name>`.** Same refusal `worktree remove`
  already gives (`ai-flow worktree list` pointer), no new error shape.
- **Target branch has no commits yet relative to the story (nothing to
  land).** Treat as already-landed: report it plainly, still clean up the
  worktree/branch/lock, do not error.
- **The story's branch has commits that are not actually from this story**
  (someone committed unrelated work into the story worktree). Not detected
  here — `land` trusts that a worktree's branch belongs to the story it was
  created for, same trust `worktree add --story` already establishes by
  naming the branch after the story directory.

## Out of scope

- The post-land re-verify of the *merged* result, and automatic rollback on
  failure — `story-02-03`. This story's "successful merge" ends at cleanup;
  it does not yet re-prove the combined state.
- `ai-flow status` reporting which worktrees are landable — `story-02-04`.
- Any octopus/multi-worktree land in one call. One `land`, one story.
