---
name: run-story
description: Composite workflow to execute one story end-to-end with an intensity mode. Use FAST for small UI/copy/simple bugs, STANDARD for normal CRUD/features/integration, and STRICT for risky work requiring deeper checks. For known security-sensitive work, use run-story-secure or STRICT mode.
---

# Run Story

## Overview

Run one prepared story through the appropriate execution pipeline.

This is the daily-driver workflow. It prevents manual chaining of the atomic skills while preserving their roles and avoiding unnecessary process for small work.

Use `run-story-secure` instead when the story touches auth, permissions, admin surfaces, user input, persistence, external integrations, secrets, payments, uploads, or sensitive data.

## Conventions

- `{project-root}` means the current repository root.
- The active story should live under `epics/epic-NN-name/story-NN-NN-name/`.
- Atomic skills remain authoritative for their own phase.
- If a phase finds blocking issues, fix them before continuing.

## Harness Automation

When `ai-flow` is available in the project, use the Security Evidence Harness automatically. The user should not need to ask for these commands.

- Before choosing or finalizing the mode, run `ai-flow harness preflight --story <story-dir>` when a story directory exists.
- Use the preflight risk and required checks to confirm FAST, STANDARD, STRICT, or escalation to `/run-story-secure`.
- **Required, non-skippable:** after implementation, run `ai-flow harness verify --story <story-dir>` to execute the declared validation commands and capture verbatim pass/fail. This is a phase of the workflow, not an optional extra — do not consider the story finished until it has run. Fix real failures rather than weakening tests.
- After implementation, validation, and notes, run `ai-flow harness check --story <story-dir>` for story work.
- At the end of STANDARD or STRICT story work, run `ai-flow harness evidence --story <story-dir>` to write `.coding-flow/runs/*-evidence.json`.
- If no story directory exists, use `ai-flow harness check --quick` after the change for a lightweight secret/sensitive-file pass.
- If the harness command is unavailable, continue the workflow and record that harness validation could not run — and do not write `## Status: done` (see below), since no proof exists.

## Status From Proof

`ai-flow status` derives a story's state from executed proof: a green `verify` shows as `verified`, a red one as `blocked`. An explicit `## Status` line in `implementation-notes.md` overrides that signal, so keep it honest:

- Write `## Status: done` **only after** a green `ai-flow harness verify` for this story is captured. A passing verify is the precondition, not the agent's assertion.
- On a red or partial verify, write `## Status: blocked` and record what failed.
- Before implementation is finished, or when verify could not run, leave `## Status: in-progress` (or `planned`) — never `done`.

The rule is simple: the user should never have to ask "did you check this?". `done` means the machine already proved it.

## Context Policy

Use the lightest context path that still lets the story ship in one focused implementation pass.

- Prefer `/quick-story` for isolated changes that can be solved from the request, `story.md`, and direct target files.
- Use FAST when a story folder exists but orchestration would be heavier than the change.
- Use STANDARD for normal feature work; create a compact Context Map instead of reading the whole project.
- Use STRICT or `/run-story-secure` for trust boundaries, migrations, permissions, or high-regression-risk changes.
- Use `/agent-context-scout` only when edit points are unclear, the story crosses modules, or broad exploration would otherwise be needed.

Context reduction must not fragment delivery. After the edit points are clear, implement code, tests, validation, and notes together.

## Choose Intensity

If the user provides a mode, use it. Otherwise infer the lightest safe mode.

### FAST

Use for:

- small UI changes
- text/copy updates
- simple bugs
- isolated components
- low-risk local changes

Pipeline:

1. Create a lightweight inline packet with scope, stop conditions, rollback notes, and likely files.
2. Use `/implement-slice`.
3. Use lightweight `/tests-check`.
4. Use `/blueprint-implementation-notes` only when notes are useful.

FAST mode may use a lightweight inline Execution Packet, but it still needs explicit Stop Conditions and Rollback Notes before editing.

### STANDARD

Use for:

- CRUD
- normal product features
- frontend/backend integration
- ordinary vertical stories

Pipeline:

1. Use `/agent-orchestrator` to create a compact Execution Packet, Context Map, Validation Gates, Stop Conditions, and Rollback Notes.
2. Use `/implement-slice` to implement the story end-to-end.
3. Use `/tests-check` to validate test adequacy.
4. Use `/architecture-check` to validate architecture quickly.
5. Use `/review-codebase` for the final pre-merge review.
6. If blocking issues exist, use `/implement-slice` to fix them and repeat the failed checks.
7. Use `/blueprint-implementation-notes` to update `implementation-notes.md`.

### STRICT

Use for:

- auth
- admin
- permissions
- payments
- database migrations
- risky refactors
- security-sensitive work
- enterprise workflows
- high-regression-risk changes

Pipeline:

1. Use `/agent-planner` or `/grill-me` if requirements are unclear.
2. Use `/agent-context-scout` first if broad discovery would be needed.
3. Use `/agent-orchestrator` to create the Execution Packet, Context Map, Validation Gates, Stop Conditions, and Rollback Notes.
4. Use `/tdd` for critical logic.
5. Use `/implement-slice`.
6. Use `/tests-check`.
7. Use `/e2e-check`.
8. Use `/architecture-check`.
9. Use `/security-check`.
10. Use `/review-codebase`.
11. If blocking issues exist, use `/implement-slice` to fix them and repeat failed checks.
12. Use `/blueprint-implementation-notes`.

## Escalation Rules

- Escalate from `/architecture-check` to `/agent-validator-architecture` when the story introduces new patterns, crosses modules, or includes a refactor.
- Escalate from `/tests-check` to `/agent-validator-tests` when tests are complex, flaky, missing for risky logic, or release-sensitive.
- Escalate to `/agent-context-scout` when targeted discovery exceeds the mode budget before edit points are clear.
- Switch to `/run-story-secure` when security-sensitive behavior appears during implementation.

## Stop Conditions

- The story scope is ambiguous enough to cause rework.
- Required project commands cannot be identified.
- Validation fails and the root cause is outside story scope.
- Security-sensitive behavior is discovered and needs the secure pipeline.
- Database schema requires breaking changes.
- Auth, role, or permission model is unclear.
- Existing architecture conflicts with the requested implementation.
- Story acceptance criteria are incomplete or not testable.

## Rollback Notes

Before implementation, capture:

- Files or areas likely to change.
- Any migration/data rollback concerns.
- Any config or feature-flag rollback path.
- Manual cleanup steps if validation fails.

## Output

```md
# Run Story Result

## Story

- 

## Intensity

FAST / STANDARD / STRICT

## Pipeline Status

- Orchestration:
- Context Map:
- Implementation:
- Tests check:
- Architecture check:
- Review:
- Notes:

## Files Changed

- 

## Validation

- 

## Fixes Applied

- 

## Rollback Notes

- 

## Remaining Risks

- 
```
