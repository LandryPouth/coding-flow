---
name: run-story-secure
description: Composite STRICT workflow to execute one security-sensitive story end-to-end. Use for auth, permissions, admin surfaces, user input, persistence, external integrations, secrets, payments, uploads, sensitive data, or any story needing security validation.
---

# Run Story Secure

## Overview

Run one prepared story through the secure `STRICT` execution pipeline.

This workflow includes the normal story pipeline plus security validation. Use it whenever trust boundaries, privileged actions, private data, or hostile input are involved.

## Conventions

- `{project-root}` means the current repository root.
- The active story should live under `epics/epic-NN-name/story-NN-NN-name/`.
- Server-side enforcement beats client-side checks.
- Atomic skills remain authoritative for their own phase.

## Harness Automation

When `ai-flow` is available in the project, use the Security Evidence Harness automatically. This is part of the secure workflow, not an optional manual step.

- Before orchestration, run `ai-flow harness preflight --story <story-dir>` and use the output to confirm risk, stop conditions, and required checks.
- After implementation, run `ai-flow harness verify --story <story-dir>` to execute the declared validation commands and capture verbatim pass/fail; a failed command is a blocker, not something to work around.
- After implementation, validators, and `implementation-notes.md`, run `ai-flow harness check --story <story-dir>`.
- If the harness check fails, fix the issue or report a blocking security risk before finalizing.
- At the end, run `ai-flow harness evidence --story <story-dir>` to write `.coding-flow/runs/*-evidence.json`.
- If the harness command is unavailable, record that harness validation could not run and keep the normal secure validators.

## Pipeline

1. Use `/agent-planner` or `/grill-me` if requirements, permissions, or data visibility are unclear.
2. Use `/agent-context-scout` if trust boundaries or edit points are spread across modules.
3. Use `/agent-orchestrator` to create the Execution Packet, Context Map, Validation Gates, Stop Conditions, and Rollback Notes.
4. Use `/tdd` for critical permission, validation, or workflow logic.
5. Use `/implement-slice` to implement the story end-to-end.
6. Use `/tests-check` to validate test adequacy.
7. Use `/e2e-check` for critical auth/admin/user journeys.
8. Use `/architecture-check` to validate architecture quickly.
9. Use `/security-check` to validate trust boundaries and common security risks.
10. Use `/review-codebase` for the final pre-merge review.
11. If blocking issues exist, use `/implement-slice` to fix them and repeat the failed checks.
12. Use `/blueprint-implementation-notes` to update `implementation-notes.md`.

## Deep Validator Escalation

- Use `/agent-validator-security` for auth systems, permission models, payments, uploads, secrets, external integrations, or sensitive data.
- Use `/agent-validator-architecture` for security changes that alter boundaries, data flow, or module ownership.
- Use `/agent-validator-tests` when security behavior lacks strong test evidence.
- Use `/agent-context-scout` when secure implementation would otherwise require broad codebase exploration. The scout maps context only and does not modify files.

## Required Security Questions

- Who is allowed to perform this action?
- Where is authorization enforced server-side?
- What input is hostile?
- What private data could leak?
- What validation or tests prove the boundary works?

## Stop Conditions

- Authorization rules are unclear.
- Data visibility rules are unclear.
- Server-side validation is missing or unknown.
- Secrets, uploads, payments, or sensitive data are involved and no deep validator has reviewed the change.
- Database schema requires breaking changes.
- Required validation commands cannot run.
- Existing architecture conflicts with the requested implementation.
- Story acceptance criteria are incomplete or not testable.
- External API contracts, credentials, or trust boundaries are unknown.

## Rollback Notes

Before implementation, capture:

- Files or areas likely to change.
- Auth/permission rollback considerations.
- Data/schema rollback considerations.
- Config, secret, or feature-flag rollback path.
- Manual cleanup steps if validation fails.

## Output

```md
# Run Story Secure Result

## Story

- 

## Pipeline Status

- Orchestration:
- Context Map:
- Implementation:
- Tests check:
- Architecture check:
- Security check:
- Review:
- Notes:

## Security Findings

- 

## Files Changed

- 

## Validation

- 

## Rollback Notes

- 

## Remaining Risks

- 
```
