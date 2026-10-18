# Story 14-03 — Plan

## Implementation Context

- **Execution mode**: STRICT (new proof semantics; creates and removes
  worktrees). Scout pre-step: yes — read how `worktree.js` creates, links
  env files and cleans up, and the mutation experiment's method (Uncle Bob
  study, *Reproducing*).
- **Likely files**: `bin/lib/red-at-base.js` (new, core: called by verify),
  `bin/lib/evidence.js` (attach result), `bin/lib/harness.js` (flag),
  `bin/lib/harness-config.js` (`redAtBase` key), `bin/lib/bootstrap.js`
  (suggestion), `bin/lib/usage.js`, `harness-report.js`.
- **Layering**: it must not require `worktree.js` (a layer); use `git
  worktree add --detach` directly through the core's git helpers.

## Decisions

- **Two identical worktrees, not base vs the user's tree.** Comparing a clean
  base with a dirty working tree conflates "the fix works" with "my machine
  has extra files". Same setup on both sides isolates the code change.
- **Targeted command, not the full suite.** The whole suite at base fails for
  unrelated reasons often enough to make "red" meaningless, and costs the
  full suite twice (145 s here).
- **Origin**: Experiment 1 showed throwaway-worktree runs are fast and safe
  here; this reuses the method for a narrower question.

## Acceptance Traceability

- 1–5 → `test/red-at-base.test.js` (throwaway repos, `node --test {files}`).
