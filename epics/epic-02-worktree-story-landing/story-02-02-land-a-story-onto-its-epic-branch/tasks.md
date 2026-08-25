# Tasks — Story 02-02

- [ ] Targeted discovery: re-read `worktreeRemove`'s lookup/dirty-check/
      cleanup sequence, `ship.js`'s `epicCompleteness`, `audit.js`'s
      `latestVerifyByStoryDir`/`isStale`/`gate`, `identity.js`'s
      `computeTreeToken`.
- [ ] Implement `worktreeLand` in `bin/lib/worktree.js`: lookup, clean-tree
      precondition, wrong-checkout precondition, verify precondition
      (green + non-stale).
- [ ] Implement the merge mechanism: ff-only attempt, rebase-in-story-
      worktree fallback, conflict stop, already-landed short-circuit.
- [ ] Implement success cleanup: worktree/branch removal, lock clear.
- [ ] Wire the `land` branch into `worktreeCommand`'s dispatcher.
- [ ] Write tests per `plan.md`, real temp git repos, no mocked `git`.
- [ ] Run `npm test`; fix; capture verify.

## Result

_(filled by /flow-run — include Rollback Notes)_

### Rollback Notes
