---
name: quick-story
description: Minimal workflow for small, isolated changes. No orchestration, no formal artifacts. Use for copy updates, simple bug fixes, or isolated component changes that do not need an Execution Packet or architecture review. Prefer this over run-story FAST when the change is bounded to a single file or clearly isolated area.
---

# Quick Story

## When To Use

Use instead of `$run-story FAST` when:

- the change is isolated to a single file or a clearly bounded area
- no architecture review is needed
- acceptance criteria are obvious from the task description
- no migration, auth, or data change is involved

Do not use when:

- the story is ambiguous or cross-module
- auth, permissions, or persistence is involved
- security validation is needed
- multiple independent areas need to change

## Contract

- **Reads**: user request or `story.md`, plus direct target files found by 1-3 targeted searches
- **Produces**: working code + passing tests
- **Artifacts**: none required - update `implementation-notes.md` only if the change is non-trivial; skip `decisions.md` unless a real tradeoff occurred
- **Skips**: Execution Packet, Validation Gates, Rollback Notes, `decisions.md`

## Context Budget

- Start from the named file, component, route, command, or error message.
- Run at most 3 targeted searches before editing.
- Read at most 5 files before deciding whether this is still quick.
- If the edit point is still unclear, stop and switch to `$run-story FAST` or `$agent-context-scout`.

## Pipeline

1. Read the user request or `story.md`.
2. Identify the likely edit point with targeted search.
3. Implement the change.
4. Run the narrowest useful validation.
5. Update `implementation-notes.md` only if the change is non-trivial.

## Stop Conditions

Stop and switch to `$run-story FAST` or `$run-story STANDARD` when:

- the scope is larger than expected
- multiple modules need changes
- auth, permissions, or data model is involved
- tests fail for reasons outside story scope

## Output

```md
# Quick Story Result

## Change

-

## Files Changed

-

## Tests

- Command:
  - Result:

## Notes

-
```
