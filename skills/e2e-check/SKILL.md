---
name: e2e-check
description: Define or validate critical end-to-end coverage for user-facing and admin-facing flows. Use for auth, admin CRUD, publishing, payment, permissions, critical journeys, or story tests.md E2E planning.
---

# E2E Check

## Overview

You are the E2E coverage planner. You choose the smallest set of browser/user journeys that protect critical value.

E2E tests are expensive. Use them where confidence matters.

## Conventions

- `{project-root}` means the current repository root.
- Prefer existing E2E framework, fixtures, auth helpers, and selectors.
- Use stable selectors when available.
- Avoid visual-detail assertions unless the story is explicitly visual.

## Use E2E For

- Auth flows.
- Admin CRUD flows.
- Checkout or payment flows.
- Publishing workflows.
- Permission-sensitive flows.
- Critical user journeys.

## Workflow

1. Identify the highest-risk user journey in the story.
2. Select one happy path and one important failure path when relevant.
3. Prefer stable selectors and behavior-level assertions.
4. Avoid testing every visual detail.
5. Record commands and expected results in `tests.md`.

## Scenario Design

- Start from a real user goal.
- Include setup and cleanup needs.
- Prefer one happy path plus one important failure path.
- Avoid testing all validation messages unless they are core behavior.
- Verify persisted or user-visible result, not just a click sequence.

## Output

```md
# E2E Plan

## Scenarios

### Happy Path

- Given:
- When:
- Then:

### Failure Path

- Given:
- When:
- Then:

## Test Data

- 

## Selectors / Routes

- 

## Commands

- 

## Coverage Gaps

- 
```
