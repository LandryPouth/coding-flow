---
name: implement-slice
description: Implement one vertical story end-to-end with code, targeted tests, validation, and implementation notes. Use when Codex is asked to execute a prepared story folder or deliver a scoped product slice without unrelated changes.
---

# Implement Slice

## Overview

You are the Codex execution mode for one story. You read the story, implement it, validate it, and leave notes for the next agent.

The success condition is not "code changed"; it is "acceptance criteria are satisfied with validation evidence."

## Conventions

- `{project-root}` means the current repository root.
- Implement from the active story folder.
- Keep changes scoped and reversible.
- Prefer existing code style and architecture.
- Use `decisions.md` for meaningful tradeoffs.

## Before Coding

1. Read `PROJECT_RULES.md`.
2. Read `AGENT_RULES.md`.
3. Read the active story folder.
4. Read the Execution Packet or inline packet when present.
5. Read the epic `index.md` only when scope, sequencing, or dependencies are unclear.
6. Read `docs/project-context.md`, `docs/architecture.md`, or `docs/conventions.md` only when the story risk or packet requires them.
7. Confirm non-quick work has an Execution Packet, Validation Gates, Stop Conditions, and Rollback Notes.

## Implementation Strategy

1. Map acceptance criteria to code areas using the Context Map, story technical notes, or targeted search anchors.
2. Run targeted searches before opening broad directories.
3. Inspect current patterns before editing.
4. If business logic is involved, consider `$tdd`.
5. If UI is involved, preserve existing interaction and visual conventions.
6. If auth, admin, permissions, external input, or persistence is involved, plan `$security-check`.
7. Make the smallest coherent change.
8. Validate and repair.

## Execution Rules

- Implement only the story scope.
- Preserve existing architecture unless the story explicitly changes it.
- Prefer existing patterns and helper APIs.
- Keep implementation one-shot once the edit points are clear: code, tests, validation, and notes should happen in one focused pass.
- Do not load broad project context when targeted files, search anchors, or a Context Map are enough.
- If more than 8 files or 5 searches are needed before edit points are clear, stop and switch to `$agent-context-scout` unless the mode is STRICT.
- Add or update tests according to `tests.md`.
- Record meaningful architecture choices in `decisions.md`.
- Update `implementation-notes.md` after execution.

## Validation

- Run typecheck, lint, tests, and E2E where available and relevant.
- When `ai-flow` is present, run `ai-flow harness verify --story <dir>`; the captured evidence is the pass/fail of record, not a self-report.
- For each risky criterion, show a red→green: break the behavior, confirm the guarding test fails, restore, confirm it passes.
- Reject AI-slop tests: tautologies, over-mocking, implementation-mirroring, flaky or order-dependent tests.
- If a command cannot run, document why.
- Fix root causes rather than weakening tests.
- If validation reveals ambiguous requirements, stop and ask one targeted question.
- If unrelated failures exist, separate them from story failures.
- If a defined stop condition is triggered, stop and report instead of continuing.

## Final Output

```md
# Slice Implementation Result

## Summary

- 

## Acceptance Criteria Status

- [ ] 

## Files Changed

- 

## Context Used

- Context level: QUICK / FAST / STANDARD / STRICT
- Search anchors:
- Extra files beyond packet:

## Tests And Validation

- Command:
  - Result:

## Notes Updated

- `implementation-notes.md`: yes/no
- `decisions.md`: yes/no

## Remaining Risks

- 

## Stop Conditions Triggered

- 
```
