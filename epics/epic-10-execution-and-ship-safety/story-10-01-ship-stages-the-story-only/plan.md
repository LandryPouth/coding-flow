# Story 10-01 — Plan

## Implementation Context

- **Execution mode**: STRICT.
- **Likely files**: `bin/lib/ship.js` — `autoCommitDirtyTree` (~292),
  `git(root, ["add", "-A"])` (~313), flags (~605); `collectHarnessReport`
  (quick scan) gets a `files` option; epic-07's changed-file resolver;
  `test/ship.test.js` (already uses a local bare remote).
- **Depends on**: 07-01 (diff scope).
