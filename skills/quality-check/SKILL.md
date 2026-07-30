---
name: quality-check
description: Quick code-quality checklist for a normal story. Use after implementation to flag duplication clusters, high-complexity spots, naming/coupling smells, and convention drift against docs/conventions.md and RULES.md. Advisory only — never edits code. For refactors, wide duplication, or quality-critical work, use agent-validator-quality instead.
---

# Quality Check

## Overview

You are the quick code-quality checklist. Your job is to flag quality problems that make future stories more expensive — duplication, tangled coupling, high complexity, unclear naming — while the fix is still small.

Quality here means **context efficiency**, not style policing. A duplicated rule is a token tax on every future story; a stable convention lets the next pass find *the* edit point instead of N copies. Judge against the project's actual conventions, not a generic ideal.

This skill is **advisory**. It produces a review, never an edit. Deterministic quality (lint, format, typecheck, duplication detectors) is not your job — that runs as executed proof through `ai-flow harness verify`. You cover the judgment part a linter cannot.

Use `agent-validator-quality` instead when the change is a refactor, introduces wide duplication, or crosses enough of the codebase to need a full reviewer pass.

## Conventions

- `{project-root}` means the current repository root.
- Read `docs/conventions.md` and `RULES.md` before making claims.
- Read nearby code to learn the local patterns before calling something a smell.
- Recommend the smallest corrective change; never rewrite beyond the story.

## The DRY Boundary

DRY is the most misapplied principle, and worse with an agent. Do **not** recommend collapsing duplication on sight.

- Apply the rule of three: two similar blocks are not yet a pattern.
- "Duplication is cheaper than the wrong abstraction" (Metz). Coupling two things that merely *look* alike raises the blast radius of every future story.
- Flag duplication as a **signal to review**, not a defect to auto-fix. Only recommend extracting an abstraction when the cases are genuinely the same concept and will change together.

## Workflow

1. Read `RULES.md`, `docs/conventions.md`, and the active story files.
2. Inspect the changed files and their immediate neighbors.
3. Look for duplication clusters, high-complexity functions, unclear naming, and coupling that will spread the next change.
4. Decide whether any issue actually blocks the story, or is just advice.
5. Recommend the smallest corrective change, or explicitly leave duplication in place.

## Review

- Duplication that represents one concept expressed in several places.
- Function/module complexity that hides the real logic.
- Naming that does not reveal intent.
- Coupling that forces unrelated edits together.
- Convention drift from `docs/conventions.md`.
- A new abstraction with a single use and unclear payoff.

## Quality Signals

- The same rule or transformation is copied across files and will change together.
- A function is long enough that its purpose is unclear at a glance.
- A name describes the mechanism instead of the intent.
- A "shared" helper reaches into feature-specific details.
- The story introduces a second way to do an existing thing.

## Anti-Slop Quick Flags

- A premature abstraction extracted from two lookalike cases (wrong-abstraction risk).
- A "utils"/"helpers" grab-bag growing with unrelated functions.
- Renames or reformatting that touch files outside the story scope.
- A quality claim with no example — every flag names a file and a concrete case.

## Output

```md
# Quality Check

Verdict: pass/fail

## Duplication Signals

- file:line — what is duplicated, whether it is one concept, recommended action (or leave as-is)

## Complexity / Naming

-

## Coupling / Convention Drift

-

## Recommended Changes (smallest first)

-

## Deliberately Left Alone

- duplication/pattern kept because the wrong abstraction would cost more
```
