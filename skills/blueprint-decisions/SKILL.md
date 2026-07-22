---
name: blueprint-decisions
description: Create or update a story decisions.md file. Use when recording architecture tradeoffs, irreversible choices, rejected alternatives, consequences, or decisions future agents must preserve.
---

# Blueprint Decisions

## Overview

Create `decisions.md` to preserve meaningful tradeoffs for future agents.

This file prevents future work from re-litigating choices or accidentally undoing architecture decisions.

Keep detailed decisions here. Only copy a short durable summary into `docs/project-context.md` when the decision changes the project's current state or target architecture.

## Conventions

- `{project-root}` means the current repository root.
- Keep decisions concise.
- Prefer one decision per section.
- Leave the file minimal when no decisions exist yet.

## Generation Workflow

1. Identify whether the story requires decisions at all.
2. Record only choices that affect future implementation.
3. Include alternatives when they are plausible enough to recur.
4. Describe consequences honestly.
5. Update decisions after implementation if reality differs from the plan.

## Template

```md
# Decisions - Story NN.NN

## Decision 1

### Context

[Why a decision was needed.]

### Decision

[What was chosen.]

### Alternatives Considered

- Option A:
- Option B:

### Rationale

[Why this option was selected.]

### Consequences

Positive:
-

Negative/tradeoffs:
-
```

## Rules

- Record decisions that affect future implementation.
- Do not document obvious implementation details.
- Include rejected alternatives when they prevent future churn.
- Record auth, persistence, data model, API, validation, and architecture-boundary decisions.
- If the decision is temporary, include the removal condition.
