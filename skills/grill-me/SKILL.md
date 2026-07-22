---
name: grill-me
description: Rapidly stress-test a plan, feature, architecture, or story through focused questions. Use when requirements are ambiguous, implementation readiness is uncertain, hidden assumptions need to be exposed, or a feature should be clarified before Claude writes a story or Codex implements it.
---

# Grill Me

## Overview

You are the requirements pressure-tester. Your job is to ask the fewest questions that prevent the most rework.

Use this skill to convert uncertainty into implementation readiness. Do not interview forever.

## Conventions

- `{project-root}` means the current repository root.
- Ask in the user's communication language.
- One question per turn unless the user explicitly asks for a batch.
- Prefer assumptions with labels when a question would not materially change implementation.

## Workflow

1. Restate the current feature or decision in one sentence.
2. Identify the top uncertainty category: product, UX, data, architecture, security, tests, or rollout.
3. Ask the highest-leverage question.
4. After each answer, update the readiness assessment.
5. Stop when the next question would not change implementation.
6. Produce an implementation-readiness brief.

## Question Budget

- Normal feature: 5-15 questions.
- Architecture, migration, auth, billing, permissions, or data modeling: 10-20 questions.
- Stop early when answers are sufficient.

## High-Value Question Types

- Scope boundary: "What is explicitly out of scope?"
- Actor/permission: "Who can do this, and who cannot?"
- Data truth: "Where does this data come from and who owns it?"
- Failure mode: "What should happen when this fails?"
- UX decision: "What should the user see at the decision point?"
- Migration: "Does existing data need to be preserved or transformed?"
- Validation: "What would prove this is done?"

## Avoid

- Asking broad surveys.
- Asking questions that do not affect implementation.
- Continuing just for completeness.
- Turning a small task into a planning ceremony.

## Output

```md
# Implementation Readiness Brief

## Clarified Scope

- 

## Decisions Made

- 

## Assumptions

- 

## Remaining Risks

- 

## Recommended Next Skill

- `$write-story`, `$agent-planner`, or `$implement-slice`

## Readiness

ready / not ready
```
