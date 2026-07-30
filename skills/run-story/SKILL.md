---
name: run-story
description: Composite workflow to execute one story end-to-end with an intensity mode. Use FAST for small UI/copy/simple bugs, STANDARD for normal CRUD/features/integration, and STRICT for risky or security-sensitive work (auth, permissions, payments, secrets, uploads, sensitive data) that needs deeper checks and security validation.
---

# Run Story

## Overview

Run one prepared story through the appropriate execution pipeline.

This is the daily-driver workflow. It prevents manual chaining of the atomic skills while preserving their roles and avoiding unnecessary process for small work.

Use **STRICT** when the story touches auth, permissions, admin surfaces, user input, persistence, external integrations, secrets, payments, uploads, or sensitive data — STRICT runs the security validators and the required security questions below. There is no separate "secure" skill: security is the STRICT intensity of this workflow.

## Conventions

- `{project-root}` means the current repository root.
- The active story should live under `epics/epic-NN-name/story-NN-NN-name/`.
- Atomic skills remain authoritative for their own phase.
- If a phase finds blocking issues, fix them before continuing.

## Harness Automation

When `ai-flow` is available in the project, use the Security Evidence Harness automatically. The user should not need to ask for these commands.

> If the bare `ai-flow` command is not on `PATH` (common when the plugin is installed but the package was never linked globally), run the same commands through the published package: `npx @landry_pouth/coding-flow <args>` — e.g. `npx @landry_pouth/coding-flow harness verify --story <dir>`. It resolves from npm and is cached after the first call.

- Before choosing or finalizing the mode, run `ai-flow harness preflight --story <story-dir>` when a story directory exists.
- Use the preflight risk and required checks to confirm FAST, STANDARD, or STRICT (choose STRICT for any security-sensitive signal).
- **Required, non-skippable:** after implementation, run `ai-flow harness verify --story <story-dir>` to execute the declared validation commands and capture verbatim pass/fail. This is a phase of the workflow, not an optional extra — do not consider the story finished until it has run. Fix real failures rather than weakening tests.
- After implementation, validation, and notes, run `ai-flow harness check --story <story-dir>` for story work.
- At the end of STANDARD or STRICT story work, run `ai-flow harness evidence --story <story-dir>` to write `.coding-flow/runs/*-evidence.json`.
- If no story directory exists, use `ai-flow harness check --quick` after the change for a lightweight secret/sensitive-file pass.
- If the harness command is unavailable, continue the workflow and record that harness validation could not run — and do not write `## Status: done` (see below), since no proof exists.

## Status From Proof

`ai-flow status` derives a story's state from executed proof: a green `verify` shows as `verified`, a red one as `blocked`. An explicit `## Status` line in `tasks.md` overrides that signal, so keep it honest:

- Write `## Status: done` **only after** a green `ai-flow harness verify` for this story is captured. A passing verify is the precondition, not the agent's assertion.
- On a red or partial verify, write `## Status: blocked` and record what failed.
- Before implementation is finished, or when verify could not run, leave `## Status: in-progress` (or `planned`) — never `done`.

The rule is simple: the user should never have to ask "did you check this?". `done` means the machine already proved it.

## Context Policy

Use the lightest context path that still lets the story ship in one focused implementation pass.

- Prefer `/quick-story` for isolated changes that can be solved from the request, `spec.md`, and direct target files.
- Use FAST when a story folder exists but orchestration would be heavier than the change.
- Use STANDARD for normal feature work; create a compact Context Map instead of reading the whole project.
- Use STRICT for trust boundaries, migrations, permissions, security-sensitive work, or high-regression-risk changes.
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
5. Use `/quality-check` when the change adds non-trivial logic, duplication, or complexity (advisory; skip for tiny changes).
6. Use `/review-codebase` for the final pre-merge review.
7. If blocking issues exist, use `/implement-slice` to fix them and repeat the failed checks.
8. Use `/blueprint-implementation-notes` to update `tasks.md`.

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
9. Use `/quality-check` (escalate to `/agent-validator-quality` for refactors or wide duplication).
10. Use `/security-check`.
11. Use `/review-codebase`.
12. If blocking issues exist, use `/implement-slice` to fix them and repeat failed checks.
13. Use `/blueprint-implementation-notes`.

### Security Enforcement (STRICT, For Sensitive Work)

When the story touches trust boundaries, privileged actions, private data, or hostile input, STRICT is the secure pipeline. Server-side enforcement beats client-side checks. Before finalizing, answer:

- Who is allowed to perform this action?
- Where is authorization enforced server-side?
- What input is hostile?
- What private data could leak?
- What validation or tests prove the boundary works?

Escalate to `/agent-validator-security` for auth systems, permission models, payments, uploads, secrets, external integrations, or sensitive data. A red `ai-flow harness verify` or an unanswered question above is a blocker, not something to work around.

## Escalation Rules

- Escalate from `/architecture-check` to `/agent-validator-architecture` when the story introduces new patterns, crosses modules, or includes a refactor.
- Escalate from `/quality-check` to `/agent-validator-quality` when the story is a refactor, spreads duplication across modules, or needs a deeper quality pass.
- Escalate from `/tests-check` to `/agent-validator-tests` when tests are complex, flaky, missing for risky logic, or release-sensitive.
- Escalate to `/agent-context-scout` when targeted discovery exceeds the mode budget before edit points are clear.
- Switch to STRICT (security validators + `/agent-validator-security`) when security-sensitive behavior appears during implementation.

## Stop Conditions

- The story scope is ambiguous enough to cause rework.
- Required project commands cannot be identified.
- Validation fails and the root cause is outside story scope.
- Security-sensitive behavior is discovered and the story is not yet running in STRICT.
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
