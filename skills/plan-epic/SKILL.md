---
name: plan-epic
description: Composite workflow to plan an epic from product intent or brownfield analysis. Use to run planner, create the epic index, split into vertical stories, and generate story blueprints including story.md, tasks.md, tests.md, decisions.md, and implementation-notes.md.
---

# Plan Epic

## Overview

Turn product intent or brownfield discovery into an implementation-ready epic.

This is the macro planning workflow. It keeps the planning path short while still producing the artifacts Codex needs for reliable execution.

## Conventions

- `{project-root}` means the current repository root.
- Epic folders use `epics/epic-NN-name/`.
- Story folders use `story-NN-MM-name/`.
- Use vertical stories, not technical phases.
- Keep the epic small enough to start shipping quickly.
- `docs/project-context.md` is the current state map only.
- Story `decisions.md` stores detailed decisions.
- Story `implementation-notes.md` stores what actually happened during implementation.

## Pipeline

1. Use `$agent-planner` to analyze the request and choose the smallest valuable epic.
2. Use `$grill-me` only if critical requirements are ambiguous.
3. Use `$blueprint-epic-index` to create or update the epic `index.md`.
4. Use `$write-story` to define the story sequence with concise Implementation Context for each story.
5. For each selected story, use:
   - `$blueprint-story`
   - `$blueprint-tasks`
   - `$blueprint-tests`
   - `$blueprint-decisions`
   - `$blueprint-implementation-notes`
6. Recommend the first story to run.

## Context Efficiency

Planning should make implementation one-shot without forcing the implementation agent to rediscover the whole project.

For each story, include:

- likely files or directories
- search anchors
- execution mode: `QUICK`, `FAST`, `STANDARD`, or `STRICT`
- scout pre-step: `yes/no`
- areas to avoid unless needed
- validation focus

Use `$agent-context-scout` only for broad, ambiguous, cross-module, or high-risk stories. Do not use it for small isolated stories.

## Brownfield Additions

Before creating stories, inspect and update:

- `docs/project-context.md`
- `docs/architecture.md`
- `docs/conventions.md`
- `docs/roadmap.md`

Identify:

- current architecture
- existing patterns
- hardcoded data
- coupling points
- migration risks
- first safe vertical slice

Do not put the audit dump into `project-context.md`. Summarize only the durable current state, constraints, risks, and roadmap impact.

## Greenfield Additions

Before creating stories, define:

- product goal
- target users
- initial stack assumptions
- architecture constraints
- validation strategy
- smallest shippable slice

## Story Count Guidance

- Start with 2-5 stories for a normal epic.
- Create fewer stories when the first slice can validate the product direction.
- Create more only when dependencies or risk require it.

## Output

```md
# Plan Epic Result

## Epic

- Path:
- Goal:
- Scope:

## Stories

-

## First Story To Run

-

## Generated Files

-

## Assumptions

-

## Risks

-

## Recommended Next Command

Use $run-story for ...
```
