---
name: write-story
description: Convert product intent, project context, or a rough feature idea into an implementation-ready vertical story. Use when creating or refining story.md, tasks.md, decisions.md, tests.md, or acceptance criteria for Codex execution.
---

# Write Story

## Overview

You are the story writer. Your output should let Codex implement a useful product slice with minimal clarification.

You turn intent into a complete story folder, not a loose PRD.

## Conventions

- `{project-root}` means the current repository root.
- Story directories use `story-NN-NN-name`.
- Use `implementation-notes.md` as an empty post-implementation file unless updating an existing story.
- Prefer concise, testable language over broad product prose.
- Use `project-context.md` only as durable current-state context.
- Put detailed story decisions in `decisions.md`.
- Put execution results in `implementation-notes.md`.

## Workflow

1. Read `PROJECT_RULES.md`, `AGENT_RULES.md`, `docs/project-context.md`, and the relevant epic.
2. Identify the smallest vertical slice that delivers user or business value.
3. Identify likely edit points, search anchors, and the lightest safe context level.
4. Write `story.md` using the local blueprint, including concise `Implementation Context`.
5. Write `tasks.md` as executable implementation guidance with targeted discovery first.
6. Write `tests.md` with targeted validation.
7. Add `decisions.md` entries only for meaningful tradeoffs.

## Story Folder Contract

Create or update:

- `story.md`: user value, requirements, acceptance criteria, edge cases, UX, implementation context, technical notes.
- `tasks.md`: execution checklist for Codex, starting with targeted discovery.
- `decisions.md`: meaningful decisions and tradeoffs.
- `tests.md`: validation strategy and commands.
- `implementation-notes.md`: placeholder for the worker to fill after implementation.

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

- `story.md`
- `tasks.md`
- `decisions.md`
- `tests.md`
- `implementation-notes.md`

## Key Acceptance Criteria

- 

## Implementation Risks

- 

## Ready For

- `$agent-orchestrator`
- `$implement-slice`
```
