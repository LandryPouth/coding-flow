---
name: flow-run
description: Implement one story end-to-end — write the code, add the tests that protect it, and prove it with an executed verify. Use whenever the user asks to build, implement, code, or fix something: a copy tweak or an isolated bug fix as readily as a feature touching auth, permissions, payments, or a database migration. The daily driver. It picks its own intensity from the risk in the diff, and marks a story done only once a green verify proves it.
---

# Run

## Overview

Run one story: find the edit, implement the smallest coherent change, add the tests
that protect it, verify. Success is "acceptance criteria satisfied with captured
validation evidence", not "code changed". Intensity scales with risk; the modes
below are the whole pipeline — no other skill is chained by hand.

## Conventions

- The story lives under `epics/epic-NN-name/story-NN-NN-name/`: one `story.md`
  (QUICK), or `spec.md` / `plan.md` / `tasks.md`. Read whichever is there.
- Story scope is authoritative unless it conflicts with `RULES.md`. Existing
  patterns beat generic preferences; keep changes scoped and reversible.
- A phase that finds a blocking issue fixes it before the next phase.

## Harness Automation (do this without being asked)

> If bare `ai-flow` is not on `PATH`, run the same commands via
> `npx @landry_pouth/coding-flow <args>`.

**Work where the story lives.** If `ai-flow status` shows the story with
`→ wt: <path>`, `cd <path>` first: `verify --story` refuses from another checkout.

**Before any implementation, at every intensity, place and lock the story:**

```bash
ai-flow worktree place --epic <epic-dir> --story <story-dir>
ai-flow worktree lock --story <story-dir>
```

`<epic-dir>` is the story's parent. `place` reads the epic's dependency tree: the
story continues where its chain runs, or gets a new worktree when it starts a
parallel chain — then `cd` into it, and run everything below from there. If `place`
errors (an unsupported tree shape), stop and report; once resolved, place it by hand
with `ai-flow worktree add --story <story-dir>`. `lock` stops a second story from
mixing its diff into this checkout; if it refuses right after `place`, something
upstream is wrong — stop rather than work around it. If the story names stories that
must land before it starts, check they are done first. No story directory: skip both.
An epic with one story and no tree: skip `place`.

**Required at every intensity, non-skippable:** after implementation, run

```bash
ai-flow verify --story <story-dir>
```

It runs the declared validation commands and captures pass/fail verbatim; the story
is not finished until it has. Fix real failures; never weaken a test to pass. An
unchanged story replays its proof, so a re-run without an edit tells you nothing.

- **Strict project: settle the criteria first.** An unticked `## Acceptance
  Criteria` item makes verify `NOT PROVEN`. Tick what is done (`[x]`), mark what you
  knowingly leave out `[~]` (or list it under `## Deferred Criteria`), never tick
  what you did not meet. A deleted test file needs a `## Test Exemption` naming it.
- **`REFUSED`:** commands written in `plan.md` do not run when nobody is watching
  (no TTY, `CI=true`, an agent run); a bare call to a project script (`npm test`,
  `pnpm run lint`) does. Never add `--allow-plan-commands`, `AI_FLOW_FORCE_TTY` or
  `NODE_ENV=test` yourself: move the commands to `.coding-flow/config.json` with the
  user's agreement, or ask them. `--clean-env` drops credential-looking variables.
- **`NOT PROVEN` with every command green:** on risky work, behavior changed and no
  test file moved — a suite green before your edit says nothing about it. Write the
  test that fails without the change. Only a change that cannot carry one (a vendor
  bump, a config cutover) gets a `## Test Exemption` (`--test-exemption "<reason>"`
  with no story); it is copied into the evidence and the PR body. Never disable
  `requireTestChange` to finish a story.
- **Report the rung as printed.** `Coverage: verified` measured the added lines;
  `Coverage: evidence` only saw a test file move — a proxy, never "the change is
  covered"; `Coverage: exempted` rests on a declared reason. A coverage report
  (`lcov.info`, `coverage-final.json`) from the command the project already runs
  turns `evidence` into `verified`: say so.
- **A tool error is not a red suite.** Report it. If the harness cannot run at all,
  continue and record that verification could not run. Either way, no
  `## Status: done` — no proof exists.

**When the tooling is the obstacle, log it in the same pass.** A gate nothing
legitimate can satisfy, a check firing on a non-risk, an error that does not say
what to do next: add a row to `docs/DOGFOODING.md` — **always** when you disable,
relax, or exempt a check, reason included. A failing test, or a gate rightly asking
for one, is the tool working: no row.

Machinery that scales with intensity:

- STANDARD/STRICT: `ai-flow harness check --story <story-dir>` after notes, and
  `ai-flow harness evidence --story <story-dir>` at the end.
- STRICT: `ai-flow harness preflight --story <story-dir>` before implementing.
- No story directory: `ai-flow harness check --quick` (secrets, sensitive files).

## Status From Proof

`ai-flow status` derives state from executed proof (green → `verified`, red →
`blocked`). A `## Status` line overrides it, so keep it honest — and write it in
`tasks.md` (or `story.md`): a `## Status` in `spec.md` is not read.

- `## Status: done` **only after** a green verify for this story is captured. Then,
  and only then:

  ```bash
  ai-flow worktree unlock --story <story-dir>
  ai-flow worktree autoland --epic <epic-dir> --story <story-dir>
  ```

  `autoland` lands the chain onto the primary checkout when this was its last open
  story and it ran in its own worktree. Report what it says: landed; not finished (a
  sibling is still open — normal); never isolated (normal); or a land failure (a
  conflict, a red post-land verify) — stop and report, never retry blindly.
- Red or partial verify: `## Status: blocked`, with what failed. The lock stays.
- `NOT PROVEN` is not done: `in-progress` until a test covers it or an exemption is
  declared.
- Unfinished, or verify could not run: `in-progress` (or `planned`).

`done` means the machine already proved it.

## Choosing Intensity

If the user names a mode, use it. Otherwise pick the **lightest** mode that covers
the change: ask what it can break that the suite would not catch, not what subject
it touches.

**STRICT** when the change:

- alters an authorization decision, or who can reach something;
- changes a persistence schema, or needs a migration;
- moves money, credentials, or secrets;
- creates a **new** externally-reachable trust boundary (an endpoint, an upload
  path, a third-party integration).

Otherwise it is not STRICT: a form posting to an existing, validated endpoint is
STANDARD; copy or layout inside an existing page is QUICK. "Touches user input" and
"reads the database" describe nearly every feature — they are not escalation
signals. The security rules in `RULES.md` apply at every intensity; only the
ceremony scales.

**Risk is read from the diff, not the story.** Editing an auth, migration, payment
or secret path raises the bar whatever the story says, and with no story at all.
Doing it while in QUICK is the signal to switch up.

### QUICK / FAST — small, isolated changes

Copy, simple bug fixes, isolated components: obvious criteria, no
auth/permissions/data involvement.

1. Find the edit point with 1–3 targeted searches (at most ~5 files read before
   deciding it is still small).
2. Implement; run the narrowest useful validation, then `ai-flow verify`.
3. Update `## Result` only if the change is non-trivial.

Scope grows, several modules need changes, or a STRICT trigger appears: switch up.

### STANDARD — normal feature work

CRUD, product features, frontend/backend integration, ordinary vertical stories.

1. Build a compact Context Map inline: scope, likely files, validation gates,
   rollback notes, stop conditions.
2. Map the criteria to code areas; read the current patterns before editing.
3. Implement the smallest coherent slice end to end — code, the tests the story plan
   calls for, and validation in one pass.
4. `ai-flow verify`, then Review Before Done.
5. Fix, re-run what failed; update `## Result`, and `## Decisions` for meaningful
   architecture choices.

### STRICT — risky or security-sensitive work

Everything in STANDARD, plus:

1. Unclear requirements: `/flow-plan` Clarify First.
2. A scout pre-step when discovery is broad (Context Policy).
3. TDD for critical logic.
4. The Security Questions, answered before finalizing.
5. `/flow-review`, required, Deep on security, tests and architecture (Review
   Before Done).

**A bug fix carries negative evidence.** Commit the test and the fix, then run
`ai-flow verify --story <dir> --red-at-base` besides the ordinary verify: green only
when the diff's test fails at the merge base and passes at HEAD. A test that passes
at base, or fails there before reaching its tests (a missing module, a syntax error,
a failed hook), is `NOT PROVEN`. Declare `redAtBase.command` in
`.coding-flow/harness.json` as `node --test --test-reporter=tap {files}`
(`bootstrap --scan` suggests it). Only node's runner is read: a Jest, Vitest, Go or
pytest fix is proven by the ordinary verify and the review's negative evidence.

## Context Policy

Targeted searches over directory-wide reading. Run a **scout pre-step** — read-only,
producing a Context Map (files, search anchors, edit points, validation focus, risks,
areas to avoid) — only when edit points are unclear, the story crosses modules, or it
is security, migration or high-regression work. Budget: ~8 searches, ~12 files, one
screen of output, no edits. Outside STRICT, edit points still unclear after ~5
searches or ~8 files means stop and scout. Once they are clear, deliver code, tests,
validation and notes together.

## TDD (opt-in, for complex logic)

For business logic, permissions, validation, transformations, workflows and bug
fixes — not trivial UI, static content or glue.

1. State the behavior in Given/When/Then.
2. Write one failing test; confirm it fails for the expected reason.
3. Write the smallest code that passes; run it green.
4. Refactor without changing behavior; add edge cases only where they protect real
   risk.

Test behavior, not implementation: delete a test that only mirrors the code. For
each risky criterion, show red→green: break
the behavior, see the guarding test fail, restore, see it pass.

## Security Questions (STRICT, before finalizing)

- Who may perform this action, and where is that enforced server-side?
- What input is hostile, and where is it validated before persistence or use?
- What private data could leak (client bundles, logs, responses, public queries)?
- What validation or test proves the boundary holds?

An unanswered question, or a red verify, is a blocker. Auth systems, permission
models, payments, uploads, secrets and external integrations go to `/flow-review`'s
Security Deep.

## Review Before Done

Self-review the change: criteria met, no architecture drift, tests protect behavior,
no security regression, no unrelated change. QUICK: a glance. STANDARD:
`/flow-review` is opt-in — when the self-review finds something, the change crosses
modules, or on request; reviewing a diff you wrote minutes ago mostly re-reads your
own reasoning.

In STRICT, `/flow-review` is required, and the one pass must be genuinely
independent: delegate it to a fresh Agent/subagent call, handed the diff, the
contract — the request the story came from, its acceptance criteria, `RULES.md`, and
the codebase's existing conventions — and the fact that this diff's risk tier
already resolved STRICT, so it defaults Architecture, Tests, and Security to Deep —
nothing else beyond that, never your own reasoning or conclusion. Frame the prompt
adversarially: find what is wrong with this change, assume the author is
overconfident.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "Verify is green, so the change is covered." | Green means the commands passed; the suite was green before you started. Read the `Coverage:` rung — `evidence` is a proxy, not a measurement. |
| "The story is worded as a small UI change, so QUICK." | Risk is read from the diff. Editing an auth, migration or secret path means switch up. |
| "This story mentions auth, so it must be STRICT." | A story names what it is *near* as readily as what it changes. The diff decides; prose can only raise a quiet change to STANDARD. |
| "I'll declare a test exemption to keep moving." | The reason is copied into the evidence and the PR body: a recorded claim, not a mute button. |
| "The gate is wrong here, I'll turn `requireTestChange` off." | Then it protects nothing from here on. If it fired on a non-risk, that is a `docs/DOGFOODING.md` row, written now. |
| "I'll write `## Status: done`, the tests obviously pass." | `done` needs a captured green verify. `/flow-next` surfaces anything else as `unproven`. |
| "Let me run verify once more to be sure." | An unchanged story replays its proof. Without an edit in between, you learn nothing. |
| "It is faster to read the whole module than to search." | Past ~8 files or ~5 searches with no edit point, you are spending the change's budget. Scout. |

## Red Flags

Signs you have drifted — correct course yourself (Stop Conditions are where you hand
back):

- You are editing an auth, migration or payment path while running QUICK.
- You have read more than ~8 files and still cannot name the edit point.
- You added a test exemption and no `docs/DOGFOODING.md` row.
- You ran the same validation twice with no edit in between.
- You are changing a test so it passes, rather than the code it guards.
- You are touching files no acceptance criterion asked for.
- You reported "tests pass" from your own run instead of from `ai-flow verify`.

## Stop Conditions

Stop and report — do not push through — when:

- scope is ambiguous enough to cause rework, or the criteria are not testable;
- the validation commands cannot be identified or run;
- validation fails for a cause outside the story's scope;
- security-sensitive behavior turns up while not running STRICT;
- the schema needs a breaking change, or the auth/permission model is unclear;
- the existing architecture conflicts with the requested implementation;
- the change needs unrelated refactors or files outside the declared scope;
- the story names stories that must land first, and they have not.

## Rollback Notes

STANDARD and STRICT, before implementing: the files and areas likely to change,
migration or data rollback, any config or feature-flag path, manual cleanup if
validation fails — under `## Result` → `### Rollback Notes`. A QUICK change undone by
`git revert` needs none: omit the section.

## Verification

Before reporting the story as done:

- [ ] `ai-flow verify --story <dir>` ran and its output was read — the verdict is
      that output, never your own test run.
- [ ] The `Coverage:` rung was reported as printed; `evidence` was not called
      "covered".
- [ ] Any `NOT PROVEN` was resolved by a missing test or a `## Test Exemption` —
      never by lowering or disabling the gate.
- [ ] `## Status: done` was written only against a captured green verify;
      otherwise it reads `blocked` or `in-progress`.
- [ ] Any gate relaxed, exempted or disabled has its `docs/DOGFOODING.md` row.
- [ ] STANDARD/STRICT: `harness check` and `harness evidence` ran; STRICT also ran
      `harness preflight` before implementing.

A box you cannot point at command output for is not ticked.

## Output

Scale the report to the story, and omit any section that would come back empty.

**QUICK / FAST** — three lines:

```md
# Run Result

- **Changed**: what changed and why
- **Verify**: green / red (+ the failing command if red)
- **Risks**: anything genuinely unresolved, or omit this line
```

**STANDARD / STRICT** — `# Run Result`, then these `##` sections in order: Story,
Intensity, Summary (what changed and why), Acceptance Criteria Status (`- [ ]` per
criterion), Files Changed, Tests And Validation (each command and its result, then
`Verify: green / red`), Decisions Recorded (story plan: yes/no), Rollback Notes,
Remaining Risks, Stop Conditions Triggered.
