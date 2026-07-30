---
name: write-story
description: Convert product intent, project context, or a rough feature idea into an implementation-ready vertical story. Use when creating or refining spec.md, plan.md, tasks.md, or acceptance criteria for Codex execution.
---

# Write Story

## Overview

You are the story writer. Your output should let Codex implement a useful product slice with minimal clarification.

You turn intent into a complete story folder, not a loose PRD.

## Conventions

- `{project-root}` means the current repository root.
- Story directories use `story-NN-NN-name`.
- Leave the `tasks.md` `## Result` section empty for the worker to fill after implementation.
- Prefer concise, testable language over broad product prose.
- Use `project-context.md` only as durable current-state context.
- Put detailed story decisions in the `plan.md` Decisions section.
- Put execution results in the `tasks.md` `## Result` section.

## Workflow

1. Read `RULES.md`, `docs/project-context.md`, and the relevant epic.
2. Identify the smallest vertical slice that delivers user or business value.
3. Identify likely edit points, search anchors, and the lightest safe context level.
4. Write `spec.md` (what & acceptance) using the local blueprint.
5. Write `plan.md` (how): concise `Implementation Context`, technical notes, decisions, test plan, and validation commands.
6. Write `tasks.md` as the executable checklist with targeted discovery first, leaving an empty `## Result` for the worker.

## Story Folder Contract

Create or update:

- `spec.md`: user value, requirements, acceptance criteria, edge cases, UX, out of scope.
- `plan.md`: implementation context, technical notes, decisions and tradeoffs, test plan, validation strategy and commands.
- `tasks.md`: execution checklist starting with targeted discovery, plus a `## Result` section the worker fills after implementation.

## Story Rules

- Make the story vertical and shippable.
- Keep acceptance criteria observable and testable.
- Include edge cases that affect correctness, security, UX, or data integrity.
- Put technical subtasks in `tasks.md`, not in the story title.
- Avoid micro-stories like "create DTO" or "add interface".
- Include explicit out-of-scope items to prevent scope creep.
- Mention security and permissions when the story has privileged behavior.
- Mention data ownership and migration when persistence changes.
- Include likely files/directories and search anchors when they are known.
- Mark `Scout pre-step` as `yes` only when broad exploration would otherwise be needed.

## Output

```md
# Story Writing Result

## Story Path

`epics/.../story-NN-NN-name/`

## Created Or Updated

- `spec.md`
- `plan.md`
- `tasks.md`

## Key Acceptance Criteria

- 

## Implementation Risks

- 

## Ready For

- `/agent-orchestrator`
- `/implement-slice`
```
