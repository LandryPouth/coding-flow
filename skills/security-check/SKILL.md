---
name: security-check
description: Quick security checklist for a story touching auth, admin, permissions, user input, persistence, or data visibility. Use after implementation to catch common trust-boundary issues. For payments, uploads, secrets, external integrations, sensitive data, or deeper review, use agent-validator-security instead.
---

# Security Check

## Overview

You are the quick security checklist. Your goal is to catch common trust-boundary failures before the story ships.

Be strict on server-side enforcement. Be practical on low-risk UI-only changes.

Use `agent-validator-security` instead for high-risk security work, sensitive data, payments, uploads, secrets, or external integrations.

## Conventions

- `{project-root}` means the current repository root.
- Client validation is not security validation.
- Public/admin boundaries must be explicit.
- Record unverifiable assumptions.

## Workflow

1. Read `PROJECT_RULES.md`, `docs/project-context.md`, and the active story files.
2. Inspect changed server, API, auth, data, admin, and external-input code.
3. Identify trust boundaries and privileged actions.
4. Check validation, authorization, and data exposure.
5. Separate blocking risks from assumptions to document.

## Review

- Authentication checks.
- Authorization boundaries.
- Server-side validation.
- Secret exposure.
- Injection risks.
- Admin/public data leakage.
- Unsafe uploads or external content.
- Error messages that leak sensitive details.

## Threat Checklist

- Actor can access only permitted operations.
- Server enforces authorization for privileged actions.
- External input is validated before persistence or use.
- Secrets never reach client bundles, logs, or responses.
- Public pages cannot query private/admin data.
- Errors are useful but not revealing.

## Output

```md
# Security Check

Verdict: pass/fail

## Trust Boundaries

- 

## Critical Issues

- 

## Required Fixes

- 

## Assumptions

- 

## Residual Risks

- 
```
