# Story 18-02 — Plan

## Implementation Context

- **Execution mode**: STRICT. Moves proof between checkouts and runs before a
  deletion; a bug here destroys evidence.
- **Likely files**:
  - `bin/lib/worktree.js`: `landCleanup`, `worktreeLand`, `worktreeRemove`;
  - `bin/lib/worktree-plan.js`: `autoLandIfChainFinished` (calls land);
  - a small `bin/lib/proof-carry.js` (new) shared by the three paths;
  - `bin/lib/templates.js` (or wherever `init` writes `.gitignore`) for
    `.gitattributes`;
  - tests: `test/worktree.test.js`, `test/worktree-autoland.test.js`,
    `test/proof-carry.test.js` (new).
- **Search anchors**: `landCleanup`, `worktreeRemove`, `removeManagedLinks`,
  `harnessRunsDir`, `.gitattributes`.
- **Scout pre-step**: no.
- **Areas to avoid**: the merge and post-land verify sequence in
  `worktreeLand` (only insert the carry before cleanup).

## Technical Notes

- DOGFOODING rows resolved: coding-flow 2026-11-10 *status* ("a story landed
  from a worktree that is then removed loses its only proof: `land` could
  copy the story's last verify into the primary checkout's `runs/`"); epic
  17's Why (autoland deletes evidence, DOGFOODING 2026-11-09); bethl bilan P2
  (`guard-unchecked.jsonl` left modified, merge conflicts).
- Order inside land: merge → post-land verify → **carry** → cleanup. If the
  post-land verify writes evidence in the primary, the carry must not
  duplicate it (name-based skip).

## Decisions

- **Copy, never move**: the worktree is deleted afterwards anyway, and a copy
  that fails leaves both intact.
- **Union merge only for `.jsonl`**: JSON evidence files never share a name.

## Test Plan

Throwaway repo + worktree fixtures (as `test/worktree-autoland.test.js`):
verify in the worktree, land, assert status in the primary; remove --force
path; duplicate line; same-name conflict; write failure stops before delete.

## Acceptance Traceability

- 1 → `test/worktree-autoland.test.js::proof survives autoland`
- 2 → `test/worktree.test.js::remove carries evidence first`
- 3 → `test/proof-carry.test.js::duplicate lines dropped`
- 4 → `test/templates.test.js::gitattributes union for jsonl`
- 5 → `test/proof-carry.test.js::a failed carry keeps the worktree`

## Commands

```bash
npm test
```
