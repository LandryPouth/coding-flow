# Story 24-02 — Two chains run and their merge is re-verified

## User Value

`run.maxParallel: 2` lets two independent chains of an epic run at once; when
each finishes, a local merge queue integrates them one at a time, re-runs
verify on the merged tree and has an independent reviewer look at the files
both chains touched — so the conflicts parallel work moves to the merge
(bethl epics 37/38 collided on shared files) are caught before they count.
Whatever runs, the machine never holds more than two agent processes.

## Requirements

- **What a chain is**: the `chainId` that `backbone.js` already computes —
  an independent root (a tree separated by a blank line) **and** every
  branch that starts at a branch point (`s1 ├── s2 / └── s3`: `s2` and `s3`
  are two chains). A branch chain is startable once its parent story is
  `done` and landed on the epic branch; its worktree forks from the epic
  branch at that commit, never from the parent's worktree.
- **Chain cap**: `run.maxParallel` default 1, refused above 2 unless
  `run.allowMoreParallel: true` (the maintainer's cap is 2).
- **Agent cap**: `run.maxAgents` default 2, refused above 2 unless
  `run.allowMoreParallel: true`. A machine-wide semaphore — slot files under
  `$XDG_CACHE_HOME/coding-flow/agents/` (fallback `~/.cache/…`), each with
  pid, run id, epic, story, role, start time; a dead pid's slot is taken over
  and reported, the 19-03 rules. Every process a run spawns takes a slot for
  its lifetime: implementer, retry, reviewer, fix pass, crossing review, epic
  review. Slots are shared by every `ai-flow run` on the machine (24-07).
  Processes are leaves (20-01: no sub-agents), a process holds one slot and
  never waits for a second, so slots cannot deadlock.
- **Slot priority**: a freed slot goes first to work that finishes something
  (crossing review, fix pass, reviewer), then to a new implementation — the
  queue drains before it grows.
- **Overlap check before a second chain starts**: compare the two chains'
  remaining stories' declared *Likely files* and the paths the running chain
  already changed. A shared path listed in `run.serialPaths` (default:
  migration directories, schema files, lockfiles, generated clients) makes
  the second chain wait until the first has integrated; any other shared
  path is allowed and pre-flagged for the crossing review. Recorded as event
  `chain.overlap`.
- Chains run each in their own worktree (20-02, 24-01).
- **Merge queue** (local, sequential): a finished chain enters the queue; the
  queue merges it into the epic branch in a scratch worktree, runs verify on
  the merged tree (all required tiers), and when the other chain already
  landed and both touched common files, runs a read-only review process on
  those files (findings recorded, scope `crossing`).
- Green + no open P0/P1 → the merge is fast-forwarded onto the epic branch.
  Red or open P1 → the later chain is parked (`blocked (merge)`), never the
  earlier; the run continues with what remains.
- The 19-03 machine queue still applies: two verifies never run at once on
  the machine.
- Events `queue.enter`, `queue.merge`, `queue.park`, `agent.slot.wait`,
  `agent.slot.take`.

## Acceptance Criteria

- [ ] Given `maxParallel: 3` or `maxAgents: 3` without the allow flag, then
      the run refuses.
- [ ] Given two independent roots, then both chains start and run in separate
      worktrees.
- [ ] Given a tree `s1 ├── s2 / └── s3`, when `s1` is done and landed, then
      `s2` and `s3` start as two chains forked from the epic branch.
- [ ] Given two running chains and one more process to start (a reviewer),
      then it waits for a slot and never makes three live agent processes.
- [ ] Given a crossing review and a new implementation both waiting, when a
      slot frees, then the crossing review takes it.
- [ ] Given two chains whose likely files share a path in `run.serialPaths`,
      then the second waits until the first has integrated.
- [ ] Given both chains touching one file, when the second integrates, then a
      crossing review runs on that file.
- [ ] Given a merged tree that fails verify, then the later chain is parked
      and the epic branch is unchanged.
- [ ] Given a green integration, then the epic branch advances and the scratch
      worktree is removed.

## Edge Cases

- A textual merge conflict: the later chain parks with the conflicting files
  (reuse `conflictingFiles`).
- Driver crash mid-queue: resume (20-06) restarts the integration from
  scratch; slots held by the dead driver's children are taken over once
  their pids are dead.
- Two stories sharing no file but one value (an enum member born in one,
  declared dead in the other — bethl DOGFOODING 2026-08-30): the overlap
  check cannot see it; the merged verify and the crossing review are the net.
  Recorded as a known limit, not hidden.
- An interactive Claude session on the same machine takes no slot: the cap
  covers what the tool spawns, and the docs say so.

## Out of Scope

- More than one machine (24-03).
- Two epics at once (24-07, which reuses these slots and this queue).

## Security

- Unattended merges only into the epic branch, never into the base or main;
  promotion stays `land`/PR (24-04).
- Verify on the merged tree is the CLI's, never the agents'.
