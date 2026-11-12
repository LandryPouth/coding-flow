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

## Acceptance Traceability

- 1, 5 → `test/epic-numbers.test.js`
- 2–4 → `test/doctor.test.js`
- 6 → `evals/cases/flow-plan.json`

## Commands

```bash
npm test
```
