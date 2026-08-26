# Plan - Story 01.01

## Implementation Context

Likely files or directories:

- `src/` - likely application source
- `app/` or `pages/` - likely routes/pages
- `components/` - likely UI content

Search anchors:

- `hardcoded`
- `Hero`
- `homepage`
- `content`

Execution mode:

- `FAST`

Scout pre-step:

- `no`

Avoid unless needed:

- auth modules
- billing modules
- unrelated admin surfaces

## Technical Notes

Prefer targeted search. Do not refactor content during the audit.

## Decisions

- Decision: Audit first, migrate second.
  - Reason: Reduces risk and prevents premature CMS abstractions.
  - Consequence: No user-facing change in this story.

## Test Plan

This is an audit story. Validation is mostly manual.

- [ ] Confirm search anchors were run.
- [ ] Confirm recommendation names one concrete section.
- [ ] Confirm no application code was modified.

## Commands

- Command: `git diff --name-only`
  - Expected: only story notes changed, if any.

## Rollback

No application code changes, so there is nothing to roll back beyond deleting the notes.
