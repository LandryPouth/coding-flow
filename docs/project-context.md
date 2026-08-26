# Project Context

This file is the durable state map of the project.

Keep it current, compact, and useful for future agents. Do not use it as a scratchpad, audit dump, story decision log, or implementation log.

## How To Fill This File

- Prefer short, factual bullets.
- Record current reality, not hopes or temporary plans.
- Move detailed story tradeoffs to the story `plan.md` Decisions section.
- Move execution history to the story `tasks.md` `## Result` section.
- Update this file only when the durable product or architecture context changes.

Example level of detail:

```txt
The app is a B2B dashboard for managing customer invoices. Admins can create customers and invoices. Customers can view invoices through a private portal. The current implementation uses static invoice data and needs migration toward persisted, admin-managed records.
```

## Product Summary

[2-4 sentences: what the product is, who it serves, and why it exists.]

## Current State

- What is implemented:
- What is static or mocked:
- What is dynamic or persisted:
- Known limitations:

## Target Direction

- Product direction:
- Architecture direction:
- What should stay stable:
- What is expected to change:

## Core Domains

- Domain:
  - Owns:
  - Key rules:
- Domain:
  - Owns:
  - Key rules:

## Data Model

- Entity:
  - Owner:
  - Important fields:
  - Relationships:
- Entity:
  - Owner:
  - Important fields:
  - Relationships:

## User Roles

- Role:
  - Can:
  - Cannot:
- Role:
  - Can:
  - Cannot:

## Important Workflows

### Workflow Name

- Actor:
- Trigger:
- Main path:
- Failure states:
- Validation:

## Technical Constraints

- Frontend:
- Backend:
- Database:
- Auth:
- Styling:
- Testing:
- Deployment:
- Security:

## Known Risks

- Risk:
  - Impact:
  - Mitigation:
- Risk:
  - Impact:
  - Mitigation:

## Current Roadmap

- Now:
- Next:
- Later:

## Decisions Summary

[Short summary of durable decisions only. Detailed decisions belong in the story-level `plan.md` Decisions section.]

## Agent Notes

- `project-context.md` = durable current state of the project.
- `plan.md` = the story plan: how, decisions, and test plan.
- `tasks.md` = the execution checklist and the `## Result` of what was actually implemented.
- Keep this file dense, scannable, and stable.
