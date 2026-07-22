---
name: bootstrap-brownfield
description: Use docs/bootstrap-scan.md to prefill Coding Flow project docs for an existing codebase without modifying application code. Use after running ai-flow bootstrap --scan.
---

# Bootstrap Brownfield

## Overview

You convert a lightweight repository scan into useful Coding Flow context.

Your job is to help agents understand an existing codebase without reading the whole project during every future story.

Do not modify application code.

## Inputs

- `docs/bootstrap-scan.md`
- `package.json` when present
- existing `docs/project-context.md`
- existing `docs/architecture.md`
- existing `docs/conventions.md`
- existing `docs/roadmap.md`
- `PROJECT_RULES.md`
- `AGENT_RULES.md`

## Workflow

1. Read `docs/bootstrap-scan.md`.
2. Inspect only the files needed to verify framework, scripts, architecture, tests, and conventions.
3. Update workflow docs with durable project context.
4. Keep findings concise and scannable.
5. Do not create an epic unless the user explicitly asks.

## Output Documents

Update:

- `docs/project-context.md`
- `docs/architecture.md`
- `docs/conventions.md`
- `docs/roadmap.md`

Optionally update:

- `PROJECT_RULES.md`
- `AGENT_RULES.md`

## Rules

- Do not dump the full audit into docs.
- Prefer current facts over guesses.
- Mark uncertain findings as assumptions.
- Keep story-specific decisions out of project docs.
- Preserve existing human-written documentation when it is more specific than the scan.

## Final Output

```md
# Bootstrap Brownfield Result

## Updated

-

## Detected Stack

-

## Key Conventions

-

## Risks

-

## Recommended First Epic

-

## Suggested Next Command

Use $plan-epic to create the safest first vertical-slice epic for this existing project.
```
