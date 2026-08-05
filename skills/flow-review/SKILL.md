---
name: flow-review
description: Review an implementation before merge against project rules, architecture, tests, security, and story acceptance criteria — findings first, ranked by severity. Use to validate a change, prepare a PR, or catch blocking issues. Runs as a quick checklist by default; each dimension (architecture, tests, security, quality, E2E) has an opt-in deep section for refactors, cross-module change, or high-risk work.
---

# Review

## Overview

You are the pre-merge reviewer. Lead with issues that could break behavior, degrade
architecture, weaken tests, or create security risk. This is a review skill, not a
summary skill — **findings come first**, ranked by severity, each grounded in a file
and line. Judge against the project's actual architecture and conventions, not a
generic ideal.

By default this is a quick checklist. For a refactor, cross-module change, a new
pattern, or high-risk work, run the matching **Deep** section below instead of the
quick pass for that dimension. Deterministic quality (lint, format, typecheck,
duplication detectors) is not your job — that runs as executed proof through
`ai-flow harness verify`; you cover the judgment a linter cannot.

## Conventions

- `{project-root}` means the current repository root.
- Read `RULES.md`, the relevant `docs/`, and the active story files before claiming.
- Cite files and lines; rank findings by severity. Treat missing validation evidence
  as a risk, and any unrun command as an evidence gap.
- Run the suite yourself when in doubt — never trust a reported result. When `ai-flow`
  is present, run `ai-flow harness verify --story <dir>` and read the captured evidence.

## Severity

- `P0`: production-breaking or unsafe — must fix before continuing.
- `P1`: must fix before merge.
- `P2`: should fix soon or document as a deliberate tradeoff.
- `P3`: optional improvement.

## Workflow

1. Read `RULES.md`, project docs, and the active story files.
2. Inspect the changed files and the relevant surrounding code.
3. Check behavior against acceptance criteria.
4. Cover each dimension below at the depth the change's risk warrants.
5. Separate blocking issues from non-blocking improvements; give a pass/fail verdict.

## Architecture

Quick checklist — detect drift while fixes are still small. Check module boundaries,
data flow, business-logic placement, service/repository usage, type safety, validation
boundaries, naming consistency, and decisions that should be recorded. Drift signals:
UI owns business rules; data access leaks into presentation; validation is duplicated
or only client-side; a new abstraction has one use and unclear payoff; shared modules
import feature-specific code; the story adds a second way to do an existing thing.

**Deep (refactor, cross-module, new pattern):** trace data and control flow through
the change; judge whether it becomes the new normal for the codebase. Require
meaningful decisions to be documented in `plan.md`. Prefer small corrective refactors
over broad redesign.

## Tests

Quick checklist — decide whether coverage is sufficient for the story's risk. Good
coverage is targeted; bad coverage is missing or noisy. Build a coverage matrix: for
each acceptance criterion, note the evidence (unit/integration/E2E/manual/none), its
strength (strong/weak/brittle/excessive), and the required action. Anti-slop flags: a
test that cannot fail (tautology, or re-asserting a mock you just set); assertions on
implementation details instead of observable behavior; over-mocking that fakes the
behavior under test; flaky or order-dependent tests.

**Deep (critical flows, complex logic, release-sensitive, flaky suites):** run the
suite yourself via `ai-flow harness verify` and read the evidence. For each critical
criterion require demonstrated **negative evidence** — breaking the behavior makes the
guarding test fail for the expected reason, restoring it makes it pass. Absent that,
treat the coverage as unproven regardless of a green run. Block on: risky logic with
no test; permission/security behavior with no test; a critical journey with no
E2E/manual evidence; validation commands that failed without documented cause.

## Security

Quick checklist — catch common trust-boundary failures. Client validation is not
security validation; public/admin boundaries must be explicit. Check authentication,
authorization boundaries, server-side validation, secret exposure, injection risks,
admin/public data leakage, unsafe uploads or external content, and error messages that
leak details. Be strict on server-side enforcement, practical on low-risk UI-only work.

**Deep (auth systems, permissions, payments, uploads, secrets, external integrations,
sensitive data):** assume user-controlled input is hostile. Identify assets, actors,
privileged actions, and trust boundaries; inspect changed code and adjacent auth/data
paths. Block on: missing server-side auth/authorization; user input reaching
persistence or execution without validation; secrets or private data that can leak;
admin-only data exposed publicly; error handling that reveals sensitive details.

## Quality

Advisory only — never edit code here. Quality means **context efficiency**, not style:
duplication of one concept, tangled coupling, and runaway complexity widen the blast
radius of the next story. Flag duplication clusters, high-complexity functions, unclear
naming, coupling that forces unrelated edits, and convention drift from
`docs/conventions.md`.

**The DRY boundary — read before flagging duplication:** apply the rule of three (two
similar blocks are not yet a pattern); "duplication is cheaper than the wrong
abstraction" (Metz). Treat duplication as a signal to review, never an automatic
defect. Recommend extraction only when the cases are genuinely one concept and will
change together; otherwise say so and leave them apart. Every flag names a file:line
and a concrete cost to a future story.

## E2E (opt-in, for critical journeys)

For auth, admin CRUD, checkout/payment, publishing, and permission-sensitive flows,
plan the smallest set of journeys that protect critical value — E2E is expensive, use
it where confidence matters. Prefer one happy path plus one important failure path,
stable selectors, and behavior-level assertions over visual detail. Verify the
persisted or user-visible result, not just a click sequence. Record commands and
expected results in `plan.md`.

## Review Bias

- Prefer concrete behavioral issues over style opinions.
- Avoid proposing broad rewrites unless the current change is unsafe.
- Call out both overengineering and underengineering.
- Verify tests match the story, not just that tests exist.

## Output

```md
# Review

Verdict: pass/fail

## Findings

- [P1] `path:line` — issue, impact, fix

## Required Fixes

-

## Non-Blocking Improvements

-

## Test Gaps

-

## Deliberately Left Alone

- duplication/pattern kept because the wrong abstraction would cost more

## Residual Risks

-
```
