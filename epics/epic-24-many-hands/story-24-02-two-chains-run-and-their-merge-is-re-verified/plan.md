# Story 24-02 — Plan

## Implementation Context

- **Execution mode**: STRICT — unattended merges.
- **Likely files**: `bin/lib/run.js`, `bin/lib/run-state.js`,
  `bin/lib/merge-queue.js` (new), `bin/lib/agent-slots.js` (new),
  `bin/lib/worktree.js`
  (`conflictingFiles`, scratch worktree), `bin/lib/backbone.js`,
  `bin/lib/drivers/claude.js` (crossing review), `bin/lib/machine-config.js`
  (new, global config shared with 19-03), `skills/flow-plan/SKILL.md` and
  its template copy (*Shared identifiers* line), tests
  `test/merge-queue.test.js` (new), `test/agent-slots.test.js` (new),
  `test/run.test.js`.
- **Search anchors**: `conflictingFiles`, `parseBackbone`, `buildChainIds`,
  `withFileLock`, the 19-03 verify lock (same stale-pid rules for slots).
- **Scout pre-step**: no.
- **Areas to avoid**: single-chain run behaviour.

## Technical Notes

- Concurrency in the driver: child agent processes gated by the slot
  semaphore, one merge queue; state file updates under `withFileLock`.
- Chains come from `chainId` (branch points included), not from tree roots
  only; startability = parent `done` and landed.

## Decisions

- **Park the later chain**: the earlier one already passed alone.
- **Two caps, not one**: chains bound the merges to re-verify, agents bound
  the machine and the spend. Two chains with a reviewer each would be four
  processes under a chain cap alone; the maintainer's rule is two agents.
- **Agents are per machine, chains per project**: the project knows how
  wide its trees are; only the machine knows its memory.
- **The user's number wins, uncapped** (maintainer, 2026-11-13): agent count
  is a performance choice, not a correctness one. Chains stay capped at 2
  because they multiply merges to re-verify, whatever the machine.
- **Identifiers are declared, not inferred**: a parser for every language's
  enums is not zero-dependency; the planner already reads the code it plans
  for and can list them in one line.
- **Serial paths wait, other overlaps are reviewed**: migrations and
  lockfiles conflict by construction (ordering, regenerated files), so
  running them in parallel only produces a park; ordinary shared files are
  cheaper to review at the merge than to forbid.

## Test Plan

Stub agents; fixture epics with two roots, with a branch point, and with a
shared file and a shared migration path; red merge; a third process waiting
for a slot; priority on a freed slot.

## Acceptance Traceability

- 1, 3–5 → `test/run.test.js::parallel`
- 2 → `test/machine-config.test.js`
- 6, 8 → `test/agent-slots.test.js`
- 7, 9 → `test/run.test.js::overlap`
- 10–12 → `test/merge-queue.test.js`

## Commands

```bash
npm test
```
