# Story 15-02 — Plan

## Implementation Context

- **Execution mode**: STRICT (security core; `guard.js` is high-risk from 13-03).
- **Depends on**: 13-03 (lcov, high-risk), 13-06 (ratchet), 14-04 (claim),
  15-01 (pinned survivors).
- **Likely files**: `bin/lib/guard.js` (~221 `isShellLimit`, ~355
  `sedFiles`, ~434 `shellWrites`, ~1039 `decide`), new
  `bin/lib/shell-writes.js`, `test/layering.test.js` (a test file: its
  classification change lands in the characterization commit, not the
  refactor commit).

## Decisions

- **Two commits, two proofs**: tests (strengthening) then code (claim). The
  claim forbids modifying a test, so the layering classification lands in
  the first commit, ahead of the module it names (`listed but not found`
  must tolerate it, or the module stub lands with it).
- **Cut along forms, not along line count**: the module's table of contents
  should read like the 05-05 corpus's sections.

## Acceptance Traceability

- 1, 3 → this story's verify evidence; 2 → `test/layering.test.js`;
  4 → claim; 5 → review evidence.
