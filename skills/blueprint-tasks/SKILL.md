---
name: blueprint-tasks
description: Create or update a story tasks.md file. Use when turning a story into executable implementation, testing, validation, and completion tasks for Codex.
---

# Blueprint Tasks

## Overview

Create `tasks.md` as an execution checklist for Codex.

Tasks should guide implementation and validation without turning the story into a pile of tiny technical chores.

## Conventions

- `{project-root}` means the current repository root.
- Tasks should be ordered by implementation dependency.
- Each task should have a clear done signal.
- Use project-specific commands when known.

## Generation Workflow

1. Read `story.md` and `tests.md`.
2. Turn `Implementation Context` into targeted discovery tasks.
3. Identify code areas and existing patterns to inspect.
4. Break implementation into 3-7 meaningful steps.
5. Add testing tasks mapped to risk.
6. Add validation commands.
7. Add completion tasks for notes and decisions.

## Template

```md
# Tasks - Story NN.NN

## Pre-Implementation

- [ ] Read `PROJECT_RULES.md`
- [ ] Read `AGENT_RULES.md`
- [ ] Read story `Implementation Context`
- [ ] Read epic `index.md` only if scope, dependencies, or sequencing are unclear
- [ ] Read project docs only when the context level or risk requires them
- [ ] Run listed search anchors before opening broad directories
- [ ] Stop and use `$agent-context-scout` if edit points remain unclear after the context budget
- [ ] Confirm story scope

## Implementation Tasks

- [ ] Task 1
- [ ] Task 2
- [ ] Task 3

## Testing Tasks

- [ ] Unit tests
- [ ] Integration tests
- [ ] E2E tests if required

## Validation Tasks

- [ ] Run typecheck
- [ ] Run lint
- [ ] Run tests
- [ ] Run E2E if required
- [ ] Architecture validation
- [ ] Security validation if required

## Completion

- [ ] Update `implementation-notes.md`
- [ ] Document new decisions if needed
- [ ] Summarize changed files
```

## Rules

- Tasks should guide execution without fragmenting into meaningless micro-steps.
- Include validation tasks that match project tooling.
- Keep tasks within the story scope.
- Do not split by architecture layer unless that is the actual delivery order.
- Include "inspect existing pattern" tasks when the codebase has conventions.
- Include rollback or migration tasks when data changes are involved.
- Prefer targeted discovery tasks over broad "inspect the codebase" tasks.
- Keep the task list one-shot friendly: discovery, implementation, tests, validation, notes.
