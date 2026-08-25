# Plan — Story 02-03

## Implementation Context

- **Execution mode**: STRICT — a destructive fallback path (`git reset
  --hard` on the target branch) that must fire exactly when intended and
  never otherwise.
- **Scout pre-step**: yes — re-read `harness.js`'s `verifyStoryOnce`/
  `writeVerifyEvidence` and how `run.js` already calls them, before adding a
  third caller with a slightly different shape (no story).
- **Likely files**:
  - `bin/lib/worktree.js` — `worktreeLand` from `story-02-02`: insert the
    re-verify step between "merge succeeded" and the existing cleanup call;
    move cleanup so it only runs after a green re-verify.
  - `bin/lib/harness.js` — `verifyStoryOnce({ story = null })` (`:2052`) and
    `writeVerifyEvidence` (`:2166`) are the two functions to call, not
    reimplement; `resolveValidationCommands({ storyDir: null })` (`:1096`)
    underneath them already reads `.coding-flow/config.json`'s
    `validation.commands`/`quality` for a repo-wide (no-story) run.
  - `bin/lib/context.js` — confirm `cwd` there reflects the process's actual
    working directory at the point `land` runs (it should, every other lib
    module already relies on this), since the re-verify must execute in the
    **target** checkout, not the story worktree — `land` is already required
    (`story-02-02`) to run from the target checkout, so no directory
    switching should be needed; if `verifyStoryOnce` turns out to hardcode
    or cache `cwd` in a way that fights this, that is the one thing to watch
    for during implementation.

## Technical notes

- **Capture the pre-merge SHA before merging, not after.** `git rev-parse
  <target-branch>` immediately before attempting the fast-forward in
  `story-02-02`'s code — this is the exact value `git reset --hard` targets
  on a failed re-verify. A fast-forward moves the branch pointer with no
  merge commit of its own, so there is nothing to "revert" — only a pointer
  to restore.
- **Evidence shape for the re-verify.** `verifyStoryOnce({ story: null })`
  already produces the "(repo)" shape `audit.js`'s `gate()` groups verify
  entries by when `entry.story` is absent (`audit.js:299`) — reuse this
  rather than inventing a `land`-specific evidence kind. If a caller needs
  to tell a normal repo-wide verify apart from a post-land one in
  `ai-flow report`/`status` later (`story-02-04`'s concern, not this one),
  that is an additive field, not a reason to change the shape here.
- **Ordering discipline.** `story-02-02` currently cleans up (worktree/
  branch/lock removal) immediately after a successful merge. This story
  moves that cleanup to run only after this re-verify passes — implement it
  as inserting a step and moving one function call, not as parallel/duplicate
  cleanup logic.

## Decisions

- **`printVerify` is exported from `harness.js` instead of reimplemented in
  `worktree.js`.** It is the exact formatter `ai-flow verify` already uses to
  report a failing command; the alternative (writing a second, `land`-specific
  formatter) is exactly the "not a new failure format to invent" the spec
  rules out.
- **The already-landed short-circuit does not re-verify.** No merge runs on
  that path (`git merge-base --is-ancestor` finds nothing new), so there is no
  merged result to prove — re-verifying there would be re-running the suite
  against an unchanged tree for no reason.
- **The retry test fixes the target's own validation config, not the story
  worktree, and lands through the rebase-replay path rather than a second
  ff-only.** The story's diff plays no part in why the fixture's re-verify
  fails, so the realistic fix is target-side; committing it moves the target
  ahead of the still-unmerged story branch, so the retried `land` exercises
  the rebase fallback too — a retry after rollback is not required to stay on
  whichever merge path the first attempt took.

## Test plan

- `test/worktree.test.js`, extending the `land` section: green re-verify →
  cleanup proceeds, evidence recorded green; red re-verify → target branch
  reset to the exact pre-merge SHA, story worktree/branch/lock untouched,
  evidence recorded red, failing command/output reported.
- A retry case: after a rollback, fix the story worktree (make the failing
  check pass) and land again — confirm it behaves like a fresh land with no
  leftover state from the failed attempt.
- A QUICK-tier story case, to pin the "not gated by story risk tier"
  acceptance criterion explicitly rather than leaving it implied by the
  STRICT-tier tests alone.

## Acceptance traceability

| Criterion | Test |
|---|---|
| green re-verify → cleanup + green evidence | `test/worktree.test.js` |
| red re-verify → exact rollback, story worktree untouched | `test/worktree.test.js` |
| failed land recorded as evidence (status/audit-visible) | `test/worktree.test.js` |
| retry after rollback behaves like a fresh land | `test/worktree.test.js` |
| rollback fires regardless of story's own execution tier | `test/worktree.test.js` |

## Commands

```
npm test
```
