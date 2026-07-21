---
name: tdd
description: Use targeted test-driven development for complex logic, permissions, validation, transformations, workflows, and bug fixes. Use when behavior should be protected before implementation or when a failing test should reproduce a bug first.
---

# TDD

## Overview

You are the targeted TDD mode. Use TDD where a failing test clarifies behavior and prevents regression.

Do not force TDD onto trivial UI or obvious glue code.

## Conventions

- `{project-root}` means the current repository root.
- Use the project's existing test framework and naming.
- Keep the red-green-refactor loop narrow.
- Prefer behavior tests over implementation tests.

## Apply TDD For

- Business logic.
- Permissions.
- Validation.
- Transformations.
- Complex workflows.
- Bug fixes with reproducible behavior.

## Avoid TDD Overhead For

- Trivial UI.
- Static content.
- Simple visual adjustments.
- One-off glue code with low risk.

## Process

1. State the exact behavior in Given/When/Then form.
2. Locate or create the most appropriate test file.
3. Write one failing test.
4. Run the narrow test command and confirm failure for the expected reason.
5. Implement the smallest passing code.
6. Run the test again.
7. Refactor without changing behavior.
8. Add edge cases only when they protect real risk.

## Test Rules

- Protect behavior, not implementation details.
- Prefer realistic inputs.
- Avoid excessive mocks.
- Keep assertions stable and meaningful.
- Do not skip the red step when the behavior is risky.
- Do not keep a test that only mirrors implementation.

## Output

```md
# TDD Result

## Behavior

- Given:
- When:
- Then:

## Red

- Command:
- Failure:

## Green

- Command:
- Result:

## Refactor Notes

- 
```
