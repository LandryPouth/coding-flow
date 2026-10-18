# Story 12-01 — Plan

## Implementation Context

- **Execution mode**: STRICT.
- **Depends on**: story-07-01 (`resolveDiffBase`); epic-08 floors if landed
  (otherwise today's rules).
- **Likely files**: `bin/lib/harness.js` — the `not evaluated (no single
  story…)` branch (~2291), `evaluateCoverageResult` (~2032: accept
  `storyDir: null`), `combineRisk`/`scoreStoryRisk` callers (story risk
  absent → diff risk only), `findReusableVerify` (~2344); `bin/lib/audit.js`;
  tests on a repo without `epics/`.

## Decisions

- **Most of the story had already landed before this run.** Since `825b487`,
  `verifyStoryOnce` with `story: null` calls `evaluateCoverage({ storyDir: null })`,
  which scores diff risk alone (story risk `low`) and applies the same rules and
  floors as a story run; the contrary signals (deleted tests, weakening) run too.
  The `"not evaluated (no single story…)"` branch this plan points at is now
  reached only by `worktree land`'s post-merge re-verify (`skipCoverage: true`,
  `4c4a2f8`), where the default-branch diff is every landed story's accumulated
  diff. That path is deliberately left as it is: the spec is about `verify`.
- **What this story changes**: the empty-diff reason ("no change to evaluate"),
  `report` counting story-less runs apart from story runs, and a test file that
  pins every acceptance criterion on a repo with no `epics/`.
- **`audit`** already keeps story-less runs apart (keyed `(repo)` in the gate);
  pinned by a test, not changed.
- **"Story-less", not "branch scope", in `report`**: story runs are measured on
  the branch diff too (`diffBase.scope: "branch"`), so the scope field cannot
  tell the two apart; `story: null` can.
- **Review finding, fixed: a story-less verify replayed land's re-verify.** Both
  record `story: null`, and the re-verify skips the coverage gate, so on an epic
  branch after a land, `ai-flow verify` answered "already proved" with no gate
  behind it. `findReusableVerify` now never replays a proof whose coverage was
  skipped (`coverage.skipped: true`, or `COVERAGE_SKIPPED_REASON` for evidence
  written before the flag, `evidence.js`); old evidence carries the
  same string, so it is excluded too.
- **Spec Kit is the one place a story-less run attributes itself**:
  `harnessVerify` scopes to the active Spec Kit feature and prints that it did
  (`Story: … (Spec Kit feature, from …)`). That predates this story and is not
  a guess from `epics/`; with `epics/` alone, nothing (not even the lock)
  attributes a run.
