# Architecture

This file explains how the project is organized and where changes should belong.

Keep it practical. Future agents should be able to use this file to avoid broad codebase exploration.

## Architecture Goals

- Maintainability:
- Testability:
- Clear boundaries:
- Fast iteration:
- Agent-friendly navigation:

## Current Stack

- Runtime:
- Framework:
- Language:
- Database:
- Auth:
- Styling:
- Testing:
- Deployment:

## Directory Map

Describe the actual project structure and ownership.

```txt
src/
  app/          # routes, pages, server actions
  features/     # feature-first modules
  components/   # reusable UI components
  lib/          # shared utilities
```

Replace the example with the real structure.

## Module Boundaries

- Module:
  - Owns:
  - Public API:
  - Must not depend on:
- Module:
  - Owns:
  - Public API:
  - Must not depend on:

## Data Flow

Document the normal request/data path.

Example:

```txt
UI -> server action/API route -> service -> repository -> database
```

Project data flow:

```txt
[Describe current flow here.]
```

## Business Logic Rules

- Business logic belongs in:
- UI components should:
- Data access should:
- Validation should happen at:

## Testing Architecture

- Unit tests:
- Integration tests:
- E2E tests:
- Manual validation:
- Test data and fixtures:

## Security Architecture

- Authentication:
- Authorization:
- Input validation:
- Secrets:
- Sensitive data:
- Audit/logging:

## Integration Boundaries

- External service:
  - Used for:
  - Contract:
  - Failure mode:
- External service:
  - Used for:
  - Contract:
  - Failure mode:

## Architecture Risks

- Risk:
  - Why it matters:
  - How to validate:

## Agent Navigation Hints

- Start feature work in:
- Start UI work in:
- Start data/API work in:
- Start auth/security work in:
- Avoid unless explicitly needed:
