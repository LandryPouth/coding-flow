# Tasks — Story 02-02

- [x] Targeted discovery: re-read `worktreeRemove`'s lookup/dirty-check/
      cleanup sequence, `ship.js`'s `epicCompleteness`, `audit.js`'s
      `latestVerifyByStoryDir`/`isStale`/`gate`, `identity.js`'s
      `computeTreeToken`.
- [x] Implement `worktreeLand` in `bin/lib/worktree.js`: lookup, clean-tree
      precondition, wrong-checkout precondition, verify precondition
      (green + non-stale).
- [x] Implement the merge mechanism: ff-only attempt, rebase-in-story-
      worktree fallback, conflict stop, already-landed short-circuit.
- [x] Implement success cleanup: worktree/branch removal, lock clear.
- [x] Wire the `land` branch into `worktreeCommand`'s dispatcher.
- [x] Write tests per `plan.md`, real temp git repos, no mocked `git`.
- [x] Run `npm test`; fix; capture verify.

## Status: done

## Result

`ai-flow worktree land <name>|--story <dir>` reconciles a finished, verified
story worktree onto the branch `land` runs from: `git merge --ff-only`
first, a rebase replayed inside the story's own worktree when the target
moved, and a hard stop (leaving the worktree mid-rebase, target untouched)
on a real conflict. Preconditions run before anything is written: clean
story worktree, run from a distinct target checkout, and — unless the
branch is already fully merged, which short-circuits straight to cleanup —
a green, non-stale verify recorded for the story. On success the story
worktree and branch are removed and the lock cleared.

All 8 acceptance criteria are covered by 9 new tests in
`test/worktree.test.js` (ff-only + cleanup + linear history, divergent
rebase + cleanup, real conflict with target untouched, dirty refusal,
wrong-checkout refusal, no-verify refusal, stale-verify refusal,
already-landed short-circuit, unknown-worktree refusal), built against real
temp git repos, no mocked `git`. Full suite: 476/476 passing.

`ai-flow verify --story epics/epic-02-worktree-story-landing/story-02-02-land-a-story-onto-its-epic-branch`
is green (`npm test`, `Coverage: evidence`). `harness check`/`harness
evidence` fail on this repo's own tree regardless of this diff — pre-existing
and already logged in `docs/DOGFOODING.md` (2026-08-24 row, `test/guard.test.js`
and `test/harness.test.js` carry intentional secret-shaped fixtures for the
scanner's own tests, and `--story` does not scope `check`'s scan); confirmed
unrelated by reproducing the identical failure unscoped on `main`.

Two pre-existing gaps found and fixed along the way, both narrow and
directly required for `land` to work at all: `audit.js`'s `isStale` was
never exported (added it), and `identity.js` never exported `computeTreeToken`
directly (used the already-exported `currentTreeToken` wrapper instead — see
`plan.md`'s Decisions).

### Rollback Notes

- Files changed: `bin/lib/worktree.js` (new `worktreeLand` + dispatcher
  wiring), `bin/lib/audit.js` (one-line export addition, no behavior
  change), `test/worktree.test.js` (new tests only).
- No schema, config, or data migration involved.
- No feature flag: `land` is a new, previously-nonexistent subcommand, so
  there is no prior behavior to preserve — a `git revert` of the commit
  fully restores the pre-change state.
- Manual cleanup if a real conflict is hit in practice (not a bug, the
  designed stop condition): the story worktree is left mid-rebase; resolve
  and `git rebase --continue`, or `git rebase --abort` to cancel. `land`
  itself never touches the target branch in that path, so no target-side
  cleanup is ever needed.
