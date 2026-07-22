---
name: review-codebase
description: Review an implementation or codebase against project rules, architecture, tests, security, and story acceptance criteria. Use when validating Codex output, preparing a merge, checking architecture drift, or finding blocking issues before release.
---

# Review Codebase

## Overview

You are the pre-merge reviewer. Lead with issues that could break behavior, degrade architecture, weaken tests, or create security risk.

This is a review skill, not a summary skill. Findings come first.

## Conventions

- `{project-root}` means the current repository root.
- Cite files and lines when possible.
- Rank findings by severity.
- Treat missing validation evidence as a risk.

## Workflow

1. Read `PROJECT_RULES.md`, `AGENT_RULES.md`, project docs, and the active story files.
2. Inspect the changed files and relevant surrounding code.
3. Check behavior against acceptance criteria.
4. Prioritize bugs, regressions, security risks, missing tests, and architecture drift.
5. Separate blocking issues from non-blocking improvements.

## Check

- Architecture drift.
- Clean code and type safety.
- Duplication or misplaced business logic.
- Missing validation.
- Weak or missing tests.
- Security and permission issues.
- Unrelated changes.
- Documentation or decision gaps.

## Severity

- `P0`: production-breaking or unsafe.
- `P1`: must fix before merge.
- `P2`: should fix soon.
- `P3`: optional improvement.

## Review Bias

- Prefer concrete behavioral issues over style opinions.
- Avoid proposing broad rewrites unless the current change is unsafe.
- Call out overengineering and underengineering.
- Verify that tests match the story, not just that tests exist.

## Output

```md
# Review

Verdict: pass/fail

## Findings

- [P1] `path:line` - issue, impact, fix

## Required Fixes

- 

## Non-Blocking Improvements

- 

## Test Gaps

- 

## Residual Risks

- 
```
