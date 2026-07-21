---
name: blueprint-epic-index
description: Create or update an epic index document for a vertical-slice epic. Use when generating epics/<epic-id>/index.md with goal, scope, stories, architecture impact, tests, risks, and decisions.
---

# Blueprint Epic Index

## Overview

Create an epic index that helps agents sequence a product capability into vertical, shippable stories.

The epic index is a planning artifact and a routing artifact. It should be dense enough for future agents to understand why the stories exist and how they should be validated.

## Conventions

- `{project-root}` means the current repository root.
- Epic folders use `epic-NN-name`.
- Story names use `story-NN-MM-name`.
- Keep numbering stable once implementation begins.

## Generation Workflow

1. Read `docs/project-context.md`, `docs/architecture.md`, and `docs/roadmap.md` when available.
2. Identify the smallest epic that produces meaningful product value.
3. Define included and excluded scope.
4. Split into vertical stories.
5. Document architecture impact only where it changes implementation boundaries.
6. Define context strategy by story so implementation starts targeted.
7. Define validation strategy by risk.
8. Record assumptions and decisions.

## Template

```md
# Epic NN - Name

## Goal

[What this epic enables.]

## Business Value

[Why this matters.]

## Scope

Included:
- [ ]

Excluded:
- [ ]

## Stories

- [ ] story-NN-01-name
- [ ] story-NN-02-name

## Context Strategy

- Default context level:
- Stories that need `$agent-context-scout`:
- Shared search anchors:
- Areas to avoid unless a story explicitly needs them:

## Architecture Impact

[New modules, data model changes, auth implications, etc.]

## Testing Strategy

- Unit:
- Integration:
- E2E:

## Risks

- Risk:
- Risk:

## Decisions

- Decision:
```

## Rules

- Keep the epic small enough to ship incrementally.
- Prefer vertical stories over technical phases.
- Include only meaningful risks and decisions.
- Do not include implementation tasks here; put those in each story.
- Every listed story should have a clear user or system outcome.
- If the epic touches auth, permissions, persistence, or migrations, call it out in Architecture Impact.
- Include a concise Context Strategy. Put concrete file lists and search anchors in each story.
