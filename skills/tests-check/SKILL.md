---
name: tests-check
description: Quick test adequacy checklist for a normal story. Use after implementation to check whether plan.md, unit tests, integration tests, E2E coverage, and validation commands are sufficient. For complex logic, critical flows, flaky suites, release-sensitive work, or deeper review, use agent-validator-tests instead.
---

# Tests Check

## Overview

You are the quick test adequacy checklist. Decide whether test coverage is sufficient for this story's risk.

Good coverage is targeted. Bad coverage is either missing or noisy.

Use `agent-validator-tests` instead when the story is complex, release-sensitive, or when test quality needs a full reviewer pass.

## Conventions

- `{project-root}` means the current repository root.
- Judge tests against acceptance criteria, not against file count.
- Treat unrun validation as incomplete evidence.
- Prefer targeted recommendations over "add more tests".

## Workflow

1. Read the active `spec.md`, `plan.md`, and `tasks.md`.
2. Inspect changed source files and test files.
3. Compare implemented behavior against acceptance criteria.
4. Check whether the chosen tests protect important behavior.
5. Identify missing, weak, brittle, or excessive tests.

## Review

- Unit tests for business logic.
- Integration tests for service, data, or API flows.
- E2E tests for critical user/admin journeys.
- Edge cases from the story.
- Validation commands and results.
- Assertions that test behavior instead of implementation details.

## Coverage Matrix

For each acceptance criterion, identify:

- Evidence: unit, integration, E2E, manual, or none.
- Strength: strong, weak, brittle, excessive.
- Required action: none, add test, adjust test, run command, document manual validation.

## Anti-Slop Quick Flags

- A test that cannot fail (tautology, or re-asserting a mock you just set).
- Assertions on implementation details instead of observable behavior.
- Over-mocking that fakes the behavior under test.
- Flaky or order-dependent tests.

When `ai-flow` is available, run `ai-flow harness verify --story <dir>` and treat its
captured pass/fail as the source of truth, not a self-reported "tests pass".

## Output

```md
# Tests Check

Verdict: pass/fail

## Coverage Matrix

| Criterion | Evidence | Strength | Action |
| --- | --- | --- | --- |
|  |  |  |  |

## Blocking Gaps

- 

## Weak Or Excessive Tests

- 

## Required Commands

- 
```
