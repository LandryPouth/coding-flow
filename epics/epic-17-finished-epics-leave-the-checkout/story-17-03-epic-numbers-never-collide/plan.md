# Story 17-03 — Plan

## Implementation Context

- **Execution mode**: STANDARD. It reads git refs and only warns.
- **Likely files**:
  - `bin/lib/epic-index.js`: read the archived numbers;
  - `bin/lib/epic-numbers.js` (new): scan disk, index and refs;
    `nextEpicNumber`;
  - `bin/lib/status.js` (`--json` fields), `bin/lib/archive.js` (print on
    `--refresh`) and `bin/lib/doctor.js`;
  - `templates/.claude/skills/flow-plan/SKILL.md` (Conventions) and
    `evals/cases/flow-plan.json`;
  - `test/epic-numbers.test.js` (new) and `test/doctor.test.js`.
- **Search anchors**: `checkDuplicateNumbering`, `duplicate_epic_number`,
  `epic-(\d+)-`.
- **Scout pre-step**: no.
- **Areas to avoid**: `worktree-plan.js`, which links chains by epic
  directory name. No change there.

## Decisions

- **Warn, never block.** A collision is a rename away from fixed, and
  blocking `status` on a ref scan would make a read-only command fragile.
- **The remote refs as last fetched.** No fetch: zero network keeps the CLI
  offline. The sources field says how fresh they are.

- **The current branch is the disk.** Its own ref is not scanned: the working
  tree is what the planner sees, uncommitted epics included. A detached HEAD
  scans every local branch.
- **A ref's copy of an epic this branch has archived is not a collision.** An
  old branch still carrying `epic-08-x` after `epic-08-x` was archived here is
  the same epic; only `archived_epic_number_reused` judges a new slug.
- **The doctor checks live in their own module.** `doctor.js` calls
  `epicNumberCollisions`; the doctor test plan's file is
  `test/epic-numbers.test.js`, not `test/doctor.test.js`, so all of the
  story's criteria are read in one place.
- **Width** is the widest number seen, never less than 2.
- **One batched read, raw bytes (review P1, P2-1).** `git ls-tree` quotes
  non-ASCII and special names under `core.quotePath`, so a slug never matched
  the disk. A single `git cat-file --batch` reads every ref's `epics` tree
  as raw bytes; refs sharing a tree are parsed once; `<prefix>` from
  `rev-parse --show-prefix` keeps a project in a subdirectory on its own path.
  Measured on a repository with 200 branches (`bench1703.sh` in the run's
  scratchpad): `status --json` 636 ms → 123 ms (90 ms without the scan),
  `doctor --json` 767 ms → 233 ms (236 ms without it).
- **One warning per conflicting epic (P2-2, P2-3).** It lists every ref that
  carries it and says to `git fetch --prune` or delete a stale branch.
- **`refs` lists only the refs that hold an epic (P2-4)**; `refsScanned`
  counts them all.

## Acceptance Traceability

- 1, 5 → `test/epic-numbers.test.js`
- 2–4 → `test/epic-numbers.test.js` (doctor cases)
- 6 → `evals/cases/flow-plan.json`

## Commands

```bash
npm test
```
