# Tasks — Story 02-03

- [ ] Targeted discovery: re-read `story-02-02`'s finished `worktreeLand`,
      `harness.js`'s `verifyStoryOnce`/`writeVerifyEvidence`/
      `resolveValidationCommands`, and `audit.js`'s "(repo)" grouping in
      `gate()`.
- [ ] Capture the target branch's pre-merge SHA before the merge attempt.
- [ ] Insert the post-merge re-verify (`verifyStoryOnce({ story: null })` +
      `writeVerifyEvidence`), running in the target checkout.
- [ ] On green: move the existing worktree/branch/lock cleanup to run here
      (after the re-verify, not immediately after the merge).
- [ ] On red: `git reset --hard` the target branch to the captured SHA,
      leave the story worktree/branch/lock untouched, report the failing
      command/output.
- [ ] Write tests per `plan.md`.
- [ ] Run `npm test`; fix; capture verify.

## Result

_(filled by /flow-run — include Rollback Notes)_

### Rollback Notes
