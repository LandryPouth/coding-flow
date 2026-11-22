# Plan — 30-05 One PR per repository, and a status that sees them

## Implementation Context

- Mode: STANDARD. Scout: no.
- Likely files: `bin/lib/ship.js` (`requireRepo` `:79`, `:649`; PR body
  builder), `bin/lib/status.js`, `bin/lib/next.js`, `bin/lib/doctor.js`,
  `bin/lib/workspace.js`, README ship/status sections.
- Depends on 30-02 (per-repository branches and worktrees).
- Avoid: a cross-repository PR; force-push.

## Decisions

- Assumption (unconfirmed): the cross-link list is a marked block in each PR
  body (like the evidence block), so human text is never overwritten.

## Test plan

- Bare repositories as remotes, `gh` stubbed by PATH; cases = acceptance
  criteria.

## Acceptance Traceability

_(to fill)_

## Commands

```bash
npm test
```
