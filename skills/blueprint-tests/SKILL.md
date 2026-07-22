---
name: blueprint-tests
description: Create or update a story tests.md file. Use when defining unit, integration, E2E, edge case, command, and expected-result validation for a story.
---

# Blueprint Tests

## Overview

Create `tests.md` as the validation contract for a story.

The test plan should protect important behavior without making Codex over-test low-risk UI.

## Conventions

- `{project-root}` means the current repository root.
- Tie tests to acceptance criteria and risk.
- Use known project commands when available.
- Mark E2E as optional unless the story justifies it.

## Generation Workflow

1. Read `story.md`.
2. Map acceptance criteria to unit, integration, E2E, or manual validation.
3. Identify risky logic that needs TDD.
4. Identify critical journeys that need E2E.
5. Include edge cases and expected commands.
6. Keep the plan small enough to execute.

## Template

````md
# Tests - Story NN.NN

## Test Strategy

[What should be tested and why.]

## Unit Tests

- [ ]

## Integration Tests

- [ ]

## E2E Tests

- [ ]

## Edge Cases

- [ ]

## Acceptance Traceability

| Acceptance criterion | Test proving it (`file::test`) |
| --- | --- |
|  |  |

## Negative Evidence (critical criteria)

- [ ] Behavior broken → guarding test fails for the expected reason → restored → passes

## Commands

```bash
npm run test
npm run typecheck
npm run lint
npm run e2e
```

## Expected Results

- [ ] All relevant tests pass
- [ ] No type errors
- [ ] No lint errors
- [ ] Critical E2E flows pass
- [ ] Each critical criterion has negative evidence (a test shown to fail without the change)
````

## Rules

- Tie tests to acceptance criteria and risk.
- Do not require E2E for trivial UI.
- Include commands that actually exist when known.
- Add tests for permissions, validation, transformations, and data integrity.
- Prefer integration coverage when bugs are likely at boundaries.
- Include manual validation only when automation would be wasteful or unavailable.

## Production-Grade Bar (No AI Slop)

Write tests a senior engineer would keep in a production repo. Reject:

- Tautological tests (assert a constant, or re-assert the mock you just set).
- Tests that restate the implementation instead of the observable behavior.
- Over-mocking that fakes the very behavior under test.
- Large snapshot blobs used as a substitute for real assertions.
- Flaky or order-dependent tests (real clock, network, randomness, shared state).
- Coverage padding: tests added only to move a percentage.

Every test must be able to fail. A test that can never fail is noise, not evidence.

## Negative Evidence

For each critical acceptance criterion, plan a proof that the guarding test bites:
break the behavior (revert the change or inject a fault), confirm the test goes red
for the expected reason, then restore and confirm green. Record the red→green in
`implementation-notes.md`. This is what separates "tests exist" from "tests prove".

## Traceability

Map each acceptance criterion to the test that proves it, as `criterion -> file::test`.
Keep this map in `tests.md` so intent and proof stay linked over time.

## Execution Of Record

Declare the exact validation commands. When `ai-flow` is available, they are run and
captured verbatim by `ai-flow harness verify --story <dir>`; that captured pass/fail
is the source of truth, not a self-reported "tests pass".
