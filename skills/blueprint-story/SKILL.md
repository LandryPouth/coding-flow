---
name: blueprint-story
description: Create or update a vertical story.md file. Use when generating epics/<epic>/story-NN-NN-name/story.md with goal, value, context, requirements, acceptance criteria, edge cases, UX notes, technical notes, dependencies, and out of scope.
---

# Blueprint Story

## Overview

Create a `story.md` that lets Codex implement a complete vertical slice with minimal ambiguity.

The story should describe product behavior, not an internal engineering checklist.

## Conventions

- `{project-root}` means the current repository root.
- Story title format: `Story NN.NN - Name`.
- Use Given/When/Then acceptance criteria where possible.
- Include assumptions when requirements are inferred.

## Generation Workflow

1. Read the parent epic index and project context.
2. State the story goal in one sentence.
3. Identify who benefits and how.
4. Convert requirements into observable behavior.
5. Add edge cases that affect correctness, security, UX, or data.
6. Add a lightweight Implementation Context so Codex can find edit points without broad exploration.
7. Add technical notes that guide architecture without overdesigning.
8. Mark out-of-scope boundaries explicitly.

## Template

```md
# Story NN.NN - Name

## Goal

[What this story delivers.]

## User Value

[Who benefits and how.]

## Context

[Relevant context from project-context, epic, existing code.]

## Implementation Context

Likely files or directories:
- `[path]` - [why it is probably relevant]

Search anchors:
- `[symbol|string/route/command]` - [what it should reveal]

Execution mode:
- `QUICK / FAST / STANDARD / STRICT`

Scout pre-step:
- `yes/no` - [yes only when edit points are unclear or broad discovery would otherwise be needed]

Avoid unless needed:
- `[path/glob]` - [why it is probably outside this story]

## Requirements

- [ ] Requirement 1
- [ ] Requirement 2

## Acceptance Criteria

- [ ] Given..., when..., then...
- [ ] Given..., when..., then...

## Edge Cases

- [ ] Edge case 1
- [ ] Edge case 2

## UX Notes

[UI and interaction notes.]

## Technical Notes

[Architecture, data flow, services, validation, etc.]

## Dependencies

- Dependency:

## Out of Scope

- [ ]
```

## Rules

- Make acceptance criteria observable and testable.
- Keep technical subtasks out of the story title.
- Keep the story vertical, not layer-based.
- Avoid "build backend" / "build frontend" stories.
- Include permission expectations when relevant.
- Include empty states, loading states, and failure states for user-facing work.
- Include data migration or compatibility notes when existing data is affected.
- Include `Implementation Context` in every story. Keep it concise: target paths, search anchors, execution mode, scout pre-step, and avoid list.
- Mark `Scout pre-step` as `yes` only when edit points are unclear or broad codebase exploration would otherwise be needed.
