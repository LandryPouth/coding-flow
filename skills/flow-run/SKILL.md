---
name: flow-run
description: Execute one prepared story end-to-end — plan the edit, implement, add tests, and verify — at an intensity that matches its risk. Use QUICK/FAST for small UI, copy, or isolated bug fixes; STANDARD for normal CRUD, features, and integration; STRICT only when the change alters an authorization decision, a persistence schema, a payment or secret path, or creates a new externally-reachable trust boundary. This is the daily driver; it runs the verify automatically and only marks a story done when a green verify proves it.
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
- The active story lives under `epics/epic-NN-name/story-NN-NN-name/`. A QUICK story
  is a single `story.md`; a STANDARD/STRICT story splits into `spec.md` / `plan.md` /
  `tasks.md`. Read whichever shape is there.
- Story scope is authoritative unless it conflicts with `RULES.md`.
- Existing code patterns beat generic preferences; keep changes scoped and reversible.
- If a phase finds blocking issues, fix them before continuing.

## Harness Automation (do this without being asked)

When `ai-flow` is available, use the harness automatically.

> If bare `ai-flow` is not on `PATH` (common when the plugin is installed but the
> package was never linked globally), run the same commands via
> `npx @landry_pouth/coding-flow <args>`.

**Required at every intensity, non-skippable:** after implementation, run

```bash
ai-flow verify --story <story-dir>
```

It executes the declared validation commands and captures verbatim pass/fail. It is
a phase, not an extra — the story is not finished until it has run. Fix real
failures; never weaken tests to pass. Re-running an unchanged story replays the
existing proof instead of re-executing, so calling it again is cheap.

**A green suite is not the same claim as "this change is covered."** When the work
is risky, `verify` also checks that the diff contains a test. If behavior changed
and no test file moved, it reports `NOT PROVEN` — every command passed, and the
proof still does not reach this change, because a suite that was already green
before your edit says nothing about it. That is not a failing test to hunt; it is
a missing one to write. Two legitimate answers:

- add the test that would fail without this change (the answer in nearly every case);
- if the change genuinely cannot carry one — a vendor bump, a config-only cutover —
  add a `## Test Exemption` section to the story stating why (or pass
  `--test-exemption "<reason>"` when there is no story). It is copied verbatim into
  the evidence and into the PR body, so it is a recorded claim, not a way to make
  the gate quiet.

**Whenever the tooling is the obstacle, log it before moving on.** Add a row to
`docs/DOGFOODING.md` when a gate blocks a change that has no legitimate way to
satisfy it, when a check fires on something that was never a risk, or when an
error message does not say what to do next — and **always** when you disable,
relax, or exempt a check to keep going, the exemption reason included. Write it
in the same pass, not at the end. A failing test or a gate that correctly asked
for one is not friction; that is the tool working, and it stays out of the log.

**A pass names how strong it is — report the rung you got.** `verify` prints
`Coverage: verified` when it measured the added lines and enough of them ran,
`Coverage: evidence` when all it saw was a test file moving alongside the change,
and `Coverage: exempted` when a declared reason carried it. `evidence` is a proxy,
not a measurement: never summarize one as "the change is covered". If the project
emits a coverage report (`lcov.info`, `coverage-final.json`) from the command it
already runs, say so — that is what turns `evidence` into `verified`.

**Risk is read from the diff, not only from the story.** Touching an auth path, a
migration, a payment or secret path raises the risk whatever the story text says —
so wording a story mildly does not lower the bar, and the gate applies to work with
no story at all. The corollary matters for you: if you find yourself editing those
paths while running QUICK, that is the signal to switch up, not to keep going.

Never disable the gate (`requireTestChange`) to finish a story.

Everything else is machinery, and scales with intensity:

- QUICK/FAST: `verify` only. One command.
- STANDARD/STRICT: also `ai-flow harness check --story <story-dir>` after notes,
  and `ai-flow harness evidence --story <story-dir>` at the end.
- STRICT only: `ai-flow harness preflight --story <story-dir>` before implementing,
  to confirm the mode against the recorded risk.
- With no story directory, `ai-flow harness check --quick` is a lightweight
  secret/sensitive-file pass.

If `verify` reports a **tool error** rather than a failing command, the harness could
not observe the result — that is not a red suite. Report it; do not treat it as a
validation failure, and do not write `## Status: done`.

If the harness cannot run at all, continue but record that verification could not
run — and do not write `## Status: done` (no proof exists).

## Status From Proof

`ai-flow status` derives a story's state from executed proof: a green `verify` shows
as `verified`, a red one as `blocked`. A `## Status` line in the story overrides
that — keep it honest:

- Write `## Status: done` **only after** a green `ai-flow verify` for this story is
  captured. A passing verify is the precondition, not your assertion.
- On a red or partial verify, write `## Status: blocked` and record what failed.
- `NOT PROVEN` (commands green, coverage gate blocked) is not `done` either. The
  story stays `in-progress` until a test covers it or an exemption is declared.
- Before implementation is finished, or when verify could not run, leave
  `## Status: in-progress` (or `planned`) — never `done`.

The user should never have to ask "did you check this?". `done` means the machine
already proved it.

## Choosing Intensity

If the user names a mode, use it. Otherwise pick the **lightest** mode that covers
the change, and ask what this change can break that the test suite would not catch —
not what subject it happens to touch.

Use **STRICT** when the change does any of these:

- alters an authorization decision, or who can reach something;
- changes a persistence schema, or needs a migration;
- moves money, credentials, or secrets;
- creates a **new** externally-reachable trust boundary (a new endpoint, a new
  upload path, a new third-party integration).

Otherwise it is not STRICT. A form posting to an existing, already-validated
endpoint creates no new boundary — that is STANDARD. Copy or layout inside an
existing page is QUICK.

"Touches user input" and "reads the database" are not escalation signals: every form
and nearly every feature does both, and treating them as STRICT means paying TDD and
E2E prices for a heading change. The security rules in `RULES.md` apply at every
intensity — what scales is the ceremony, never the constraints.

There is no separate "secure" workflow; security is the STRICT intensity of this one.

### QUICK / FAST — small, isolated changes

For copy updates, simple bug fixes, isolated components, low-risk local changes with
obvious acceptance criteria and no auth/permissions/data involvement.

1. Read the request or the story; find the edit point with 1–3 targeted searches
   (read at most ~5 files before deciding it is still small).
2. Implement the change.
3. Run the narrowest useful validation, then `ai-flow verify`.
4. Update the story `## Result` only if the change is non-trivial.

If the scope grows, several modules need changes, or the change starts matching a
STRICT trigger, switch up rather than pushing through.

### STANDARD — normal feature work

For CRUD, product features, frontend/backend integration, ordinary vertical stories.

1. Build a compact **Context Map** from the story and targeted searches (see Context
   Policy). Capture scope, stop conditions, rollback notes, likely files, and
   validation gates — inline, not a separate document.
2. Map acceptance criteria to code areas; inspect current patterns before editing.
3. Implement the smallest coherent slice end-to-end: code + tests + validation in one
   focused pass. Add/update tests per the story plan.
4. Run `ai-flow verify`; then self-review (see Review Before Done).
5. Fix blocking issues and re-run the failed checks. Update the story `## Result`
   and record meaningful architecture choices in its Decisions section.

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

An unanswered question above, or a red `ai-flow verify`, is a blocker — not
something to work around. Route to the deep security section of `/flow-review` for auth
systems, permission models, payments, uploads, secrets, or external integrations.

## Review Before Done

Before marking a story done, self-review the change: acceptance criteria met,
architecture not drifting, tests protect behavior (not implementation), no security
regression, no unrelated changes.

For a QUICK story this is a glance. In STANDARD, `/flow-review` is **opt-in** — run
it when the self-review finds something, when the change crosses modules, or on
request. A full review pass over a diff you wrote minutes ago mostly re-reads your
own reasoning; it earns its cost when the diff is large or unfamiliar, not by
default.

In STRICT, `/flow-review` is required. An independent pass is the point of STRICT.

## Common Rationalizations

Every row below is an excuse this skill has already answered somewhere above. It
is repeated here because the moment you reach for one is the moment you are not
re-reading the prose.

| Rationalization | Reality |
|---|---|
| "Verify is green, so the change is covered." | Green means the commands passed. It says nothing about whether proof reaches *your* diff — the suite was green before you started. Read the `Coverage:` rung. |
| "`Coverage: evidence` is good enough." | `evidence` means a test file moved. That is a proxy, not a measurement. Never summarize it as "the change is covered". |
| "The story is worded as a small UI change, so QUICK." | Risk is read from the diff. If you are editing an auth path, a migration, or a secret path, switch up — the wording does not lower the bar. |
| "This story mentions auth, so it must be STRICT." | A story names what it is *near* as readily as what it changes. The diff decides; prose can only raise a quiet change to STANDARD. |
| "I'll declare a test exemption to keep moving." | The reason is copied verbatim into the evidence and into the PR body. It is a recorded claim, not a mute button. |
| "The gate is wrong here, I'll turn `requireTestChange` off." | Then the gate protects nothing from here on. Never disable it to finish a story — and if it genuinely fired on a non-risk, that is a `docs/DOGFOODING.md` row, written in the same pass. |
| "I'll write `## Status: done`, the tests obviously pass." | `done` means a green verify for this story is already captured. A written status is not proof; `/flow-next` will surface it as `unproven`. |
| "Let me run verify once more to be sure." | An unchanged story replays the existing proof. Re-running without an intervening edit tells you nothing you did not already have. |
| "It is faster to read the whole module than to search." | Past ~8 files or ~5 searches without clear edit points, you are not being thorough, you are burning the budget that was meant for the change. Do a scout pass. |

## Red Flags

Signs you have already drifted — distinct from Stop Conditions, which are cases
where you stop and hand back. These are cases where you correct course yourself:

- You are editing an auth path, a migration, or a payment path while running QUICK.
- You have read more than ~8 files and still cannot name the edit point.
- You are about to write `## Status: done` without having read a verify result.
- You added a test exemption and did not add the `docs/DOGFOODING.md` row.
- You ran the same validation command twice with no edit between the two runs.
- You are changing a test so it passes, rather than changing the code it guards.
- You are touching files no acceptance criterion asked for.
- You reported "tests pass" from the agent's own run instead of from `ai-flow verify`.

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

For STANDARD and STRICT, capture before implementing: files/areas likely to change;
any migration/data rollback concerns; any config or feature-flag rollback path;
manual cleanup steps if validation fails. Record them in the story `## Result` →
`### Rollback Notes`.

A QUICK change that is reverted by `git revert` needs no rollback plan — say so by
omitting the section rather than writing "n/a".

## Output

The report scales with the story. Sections that would come back empty are omitted,
not filled with `-`: an empty field costs tokens to write and attention to read past.

**QUICK / FAST** — three lines:

```md
# Run Result

- **Changed**: what changed and why
- **Verify**: green / red (+ the failing command if red)
- **Risks**: anything genuinely unresolved, or omit this line
```

**STANDARD / STRICT** — the full report:

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
- Verify: green / red

## Decisions Recorded

- Story plan: yes/no

## Rollback Notes

-

## Remaining Risks

-

## Stop Conditions Triggered

-
```
