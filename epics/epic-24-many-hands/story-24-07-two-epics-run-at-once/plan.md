# Story 24-07 — Plan

## Implementation Context

- **Execution mode**: STRICT — unattended merges against the base.
- **Likely files**: `bin/lib/run.js`, `bin/lib/active-runs.js` (new),
  `bin/lib/merge-queue.js` (base target), `bin/lib/agent-slots.js`,
  `bin/lib/backbone.js` (`Depends on epics`), `bin/lib/doctor.js`,
  `bin/lib/status.js`, `bin/lib/serve.js` (ports),
  `templates/.claude/skills/flow-plan/SKILL.md`, tests
  `test/active-runs.test.js` (new), `test/merge-queue.test.js`,
  `test/run.test.js`.
- **Search anchors**: `withFileLock`, `git-common-dir`, `conflictingFiles`,
  `Dependencies outside this epic`.
- **Scout pre-step**: no.
- **Areas to avoid**: single-epic run behaviour; the chain queue's epic
  target (24-02).

## Technical Notes

- The base queue is 24-02's merge queue with the base as target and the
  epic branch as source; one implementation, two targets.
- The registry lives in the git common dir so every worktree sees it.

## Decisions

- **The maintainer starts each run**: the tool decides whether two runs may
  share the machine, not which epic comes next.
- **Waiting beats refusing only when asked** (`waitMinutes` default 0): a
  run that silently waits an hour looks like a hang.
- **Park the later epic**: the earlier one already landed alone.

## Test Plan

Fixture repo with two epics (dependency, serial-path overlap, plain file
overlap); stub agents; registry with a dead pid; red base merge.

## Acceptance Traceability

- 1–2, 6 → `test/active-runs.test.js`
- 3 → `test/run.test.js::two epics share slots`
- 4–5 → `test/merge-queue.test.js::base target`

## Commands

```bash
npm test
```
