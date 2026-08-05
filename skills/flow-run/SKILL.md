---
name: flow-run
description: Execute one prepared story end-to-end — plan the edit, implement, add tests, and verify — at an intensity that matches its risk. Use QUICK/FAST for small UI, copy, or isolated bug fixes; STANDARD for normal CRUD, features, and integration; STRICT for risky or security-sensitive work (auth, permissions, payments, secrets, uploads, sensitive data). This is the daily driver; it runs the harness verify automatically and only marks a story done when a green verify proves it.
---

# Run

## Overview

Run one prepared story through the right execution pipeline: understand the edit,
implement the smallest coherent change, add the tests that protect it, and verify.
The success condition is not "code changed" — it is "acceptance criteria satisfied
with captured validation evidence."

Intensity scales with risk. You do not chain separate skills by hand; the modes
below are that pipeline, inlined.

## Conventions

- `{project-root}` means the current repository root.
- The active story lives under `epics/epic-NN-name/story-NN-NN-name/` with
  `spec.md` / `plan.md` / `tasks.md`.
- Story scope is authoritative unless it conflicts with `RULES.md`.
- Existing code patterns beat generic preferences; keep changes scoped and reversible.
- If a phase finds blocking issues, fix them before continuing.

## Harness Automation (do this without being asked)

When `ai-flow` is available, use the Security Evidence Harness automatically.

> If bare `ai-flow` is not on `PATH` (common when the plugin is installed but the
> package was never linked globally), run the same commands via
> `npx @landry_pouth/coding-flow <args>`.

- Before finalizing the mode, run `ai-flow harness preflight --story <story-dir>`
  when a story directory exists; use its risk and required checks to confirm the mode.
- **Required, non-skippable:** after implementation, run
  `ai-flow harness verify --story <story-dir>` to execute the declared validation
  commands and capture verbatim pass/fail. It is a phase, not an extra — the story is
  not finished until it has run. Fix real failures; never weaken tests to pass.
- After validation and notes, run `ai-flow harness check --story <story-dir>`; for
  STANDARD/STRICT, also run `ai-flow harness evidence --story <story-dir>`.
- With no story directory, use `ai-flow harness check --quick` for a lightweight
  secret/sensitive-file pass.
- If the harness cannot run, continue but record that verification could not run —
  and do not write `## Status: done` (no proof exists).

## Status From Proof

`ai-flow status` derives a story's state from executed proof: a green `verify` shows
as `verified`, a red one as `blocked`. A `## Status` line in `tasks.md` overrides
that — keep it honest:

- Write `## Status: done` **only after** a green `ai-flow harness verify` for this
  story is captured. A passing verify is the precondition, not your assertion.
- On a red or partial verify, write `## Status: blocked` and record what failed.
- Before implementation is finished, or when verify could not run, leave
  `## Status: in-progress` (or `planned`) — never `done`.

The user should never have to ask "did you check this?". `done` means the machine
already proved it.

## Choosing Intensity

If the user names a mode, use it. Otherwise infer the lightest safe mode from the
story and the preflight risk. Use **STRICT** whenever the story touches auth,
permissions, admin surfaces, user input, persistence, external integrations, secrets,
payments, uploads, or sensitive data — there is no separate "secure" workflow;
security is the STRICT intensity of this one.

### QUICK / FAST — small, isolated changes

For copy updates, simple bug fixes, isolated components, low-risk local changes with
obvious acceptance criteria and no auth/permissions/data involvement.

1. Read the request or `spec.md`; find the edit point with 1–3 targeted searches
   (read at most ~5 files before deciding it is still small).
2. Implement the change.
3. Run the narrowest useful validation, then `ai-flow harness verify`.
4. Update the `tasks.md` `## Result` only if the change is non-trivial.

Even here, capture Stop Conditions and Rollback Notes before editing. If the scope
grows, multiple modules need changes, or auth/data appears, switch up to STANDARD.

### STANDARD — normal feature work

For CRUD, product features, frontend/backend integration, ordinary vertical stories.

1. Build a compact **Context Map** from the story and targeted searches (see Context
   Policy). Capture scope, stop conditions, rollback notes, likely files, and
   validation gates — inline, not a separate document.
2. Map acceptance criteria to code areas; inspect current patterns before editing.
3. Implement the smallest coherent slice end-to-end: code + tests + validation in one
   focused pass. Add/update tests per `plan.md`.
4. Run `ai-flow harness verify`; then self-review (see Review Before Done).
5. Fix blocking issues and re-run the failed checks. Update the `tasks.md` `## Result`
   and record meaningful architecture choices in `plan.md`.

### STRICT — risky or security-sensitive work

For auth, admin, permissions, payments, migrations, risky refactors, high-regression
work. Everything in STANDARD, plus:

1. If requirements are unclear, clarify first (`/flow-plan` Clarify First).
2. Do a scout pre-step when broad discovery is needed (see Context Policy).
3. Use **TDD** for critical logic (see below).
4. Answer the Security Questions before finalizing.
5. Broaden the review to the deep sections of `/flow-review` (security, tests,
   architecture) rather than the quick checklist.

## Context Policy

Use the lightest context path that still lets the story ship in one focused pass.
Prefer targeted searches over directory-wide reading. Run a **scout pre-step** — a
read-only pass that produces a compact Context Map (relevant files, search anchors,
likely edit points, validation focus, risks, areas to avoid) — only when edit points
are unclear, the story crosses modules, or it is security/migration/high-regression
work. Default scout budget: ~8 searches, ~12 files, one screen of output; do not edit
files during it. If more than ~8 files or ~5 searches are needed before edit points
are clear (and the mode is not STRICT), stop and do a scout pass. Context reduction
must not fragment delivery: once edit points are clear, implement code, tests,
validation, and notes together.

## TDD (opt-in, for complex logic)

Use targeted TDD where a failing test clarifies behavior and prevents regression —
business logic, permissions, validation, transformations, complex workflows, and bug
fixes. Skip it for trivial UI, static content, and low-risk glue.

1. State the behavior in Given/When/Then.
2. Write one failing test; run the narrow command and confirm it fails for the
   expected reason.
3. Implement the smallest passing code; run it green.
4. Refactor without changing behavior; add edge cases only where they protect real risk.

Protect behavior, not implementation details. Do not keep a test that only mirrors
implementation. For each risky criterion, demonstrate a red→green: break the behavior,
confirm the guarding test fails, restore, confirm it passes.

## Security Questions (STRICT, before finalizing)

When the story touches trust boundaries, privileged actions, private data, or hostile
input, server-side enforcement beats client-side checks. Answer:

- Who is allowed to perform this action, and where is authorization enforced server-side?
- What input is hostile, and where is it validated before persistence or use?
- What private data could leak (client bundles, logs, responses, public queries)?
- What validation or tests prove the boundary works?

An unanswered question above, or a red `ai-flow harness verify`, is a blocker — not
something to work around. Route to the deep security section of `/flow-review` for auth
systems, permission models, payments, uploads, secrets, or external integrations.

## Review Before Done

Before marking a story done, self-review the change: acceptance criteria met,
architecture not drifting, tests protect behavior (not implementation), no security
regression, no unrelated changes. For a quick story this is a glance; for STANDARD/
STRICT, run `/flow-review` (use its deep sections when risk warrants).

## Stop Conditions

Stop and report — do not push through — when:

- Story scope is ambiguous enough to cause rework, or acceptance criteria are not testable.
- Required validation commands cannot be identified or run.
- Validation fails and the root cause is outside story scope.
- Security-sensitive behavior is discovered while not running STRICT.
- Database schema needs breaking changes, or the auth/permission model is unclear.
- Existing architecture conflicts with the requested implementation.
- The change would require unrelated refactors or files outside the declared scope.

## Rollback Notes

Before implementing, capture: files/areas likely to change; any migration/data
rollback concerns; any config or feature-flag rollback path; manual cleanup steps if
validation fails. Record them in the `tasks.md` `## Result` → `### Rollback Notes`.

## Output

```md
# Run Result

## Story

-

## Intensity

QUICK / FAST / STANDARD / STRICT

## Summary

- What changed and why

## Acceptance Criteria Status

- [ ]

## Files Changed

-

## Tests And Validation

- Command:
  - Result:
- Harness verify: green / red

## Decisions Recorded

- plan.md: yes/no

## Rollback Notes

-

## Remaining Risks

-

## Stop Conditions Triggered

-
```
