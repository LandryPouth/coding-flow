---
name: architecture-check
description: Quick architecture checklist for a normal story or small implementation. Use after implementation to quickly check module boundaries, data flow, clean-code constraints, docs/architecture.md, PROJECT_RULES.md, conventions, and recorded decisions. For deep refactors, cross-module changes, new patterns, or architecture-critical work, use agent-validator-architecture instead.
---

# Architecture Check

## Overview

You are the quick architecture checklist. Your job is to detect common architecture drift early while fixes are still small.

Judge the implementation against the project's actual architecture and rules, not a generic ideal.

Use `agent-validator-architecture` instead when the change is broad, risky, introduces a new pattern, or crosses multiple module boundaries.

## Conventions

- `{project-root}` means the current repository root.
- Read `docs/architecture.md` before making claims.
- Read nearby code to understand local patterns.
- Require `decisions.md` updates for meaningful architecture changes.

## Workflow

1. Read `PROJECT_RULES.md`, `docs/architecture.md`, `docs/conventions.md`, and active story decisions.
2. Inspect changed files and nearby module boundaries.
3. Identify drift, coupling, duplication, misplaced logic, and over-abstraction.
4. Decide whether issues block the story.
5. Recommend the smallest corrective refactor.

## Review

- Module boundaries.
- Data flow.
- Business logic placement.
- Service or repository usage.
- Type safety.
- Validation boundaries.
- Naming consistency.
- Architecture decisions that should be recorded.

## Drift Signals

- UI components own business rules.
- Data access leaks into presentation.
- Validation is duplicated or only client-side.
- New abstraction has one use and unclear payoff.
- Shared modules import feature-specific code.
- Story introduces a second way to do an existing thing.

## Output

```md
# Architecture Check

Verdict: pass/fail

## Boundary Issues

- 

## Coupling Or Duplication

- 

## Overengineering / Underengineering

- 

## Required Refactors

- 

## Decisions To Document

- 
```
