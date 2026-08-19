---
name: flow-review
description: Review a diff before merge against project rules, architecture, tests, security, and story acceptance criteria — findings first, ranked by severity, each grounded in a file and line. Use when asked whether a change is safe, to catch blocking issues, or to check the work before a pull request goes out. Runs as a quick checklist by default; each dimension has an opt-in deep section for refactors, cross-module change, and high-risk work.
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
`ai-flow verify`; you cover the judgment a linter cannot.

## Conventions

- `{project-root}` means the current repository root.
- Read `RULES.md`, the relevant `docs/`, and the active story files before claiming.
- Cite files and lines; rank findings by severity. Treat missing validation evidence
  as a risk, and any unrun command as an evidence gap.
- Run the suite yourself when in doubt — never trust a reported result. When `ai-flow`
  is present, run `ai-flow verify --story <dir>` and read the captured evidence.

## Reviewing Your Own Diff

Most of the time this skill runs minutes after the same agent wrote the code —
`/flow-run` routes here from Review Before Done. That is the weakest reviewer
available: the reasoning that produced the defect is still in context, and
re-reading it reproduces the same conclusion. A pass under those conditions
means "I still agree with myself", which is not a review.

Review the **artifact** against the **contract**, never against your reasoning.

- The **artifact** is the diff and the code it lands in. Not your plan, not your
  summary of what you did, not the commit message.
- The **contract** is the story's acceptance criteria, `RULES.md`, and the
  conventions already in the codebase. Write it down *before* you open the diff —
  a contract derived after reading the change is a description of the change.
- Then re-derive whether the artifact satisfies the contract. If the only thing
  supporting a line is "I remember deciding this was right", you have not
  reviewed it; you have recalled it.

Two rules follow, and they are cheap:

1. **Do not state your verdict first.** Writing "this correctly handles the empty
   case" before checking turns every subsequent read into a search for
   confirmation. Findings first, verdict last — which is also why `## Findings`
   sits above the verdict in the Output block.
2. **When you delegate to a subagent, hand it the artifact and the contract only.**
   Never your reasoning, never your conclusion, never "I think this is fine, can
   you confirm". A reviewer given your conclusion returns your conclusion. Frame
   the prompt adversarially — "find what is wrong with this, assume the author is
   overconfident" — because the framing decides the answer as much as the code does.

This does not apply to a diff someone else wrote: there your context genuinely is
fresh, and the ordinary workflow below is enough.

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
suite yourself via `ai-flow verify` and read the evidence. For each critical
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

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "The suite is green, so the tests are fine." | A green run proves the commands passed, not that the tests would catch a regression. For each critical criterion, require demonstrated negative evidence. |
| "The author says it was tested." | Never trust a reported result. Run `ai-flow verify --story <dir>` yourself and read the captured evidence. |
| "These two blocks are identical, extract them." | Two similar blocks are not yet a pattern. Apply the rule of three, and prefer duplication over the wrong abstraction unless the cases are one concept that will change together. |
| "There is no test for this, so it is a blocker." | Only if the behavior carries risk. Copy, layout, and static content do not earn a test; permissions, validation, and money do. |
| "The diff is clean, I can approve without reading the surrounding code." | Drift is visible only against what was already there. Judge the change against this project's architecture, not against a generic ideal. |
| "I'll flag the style issues too, they're quick." | Deterministic quality runs as executed proof through `ai-flow verify`. Your findings are the judgment a linter cannot make; style noise buries them. |
| "I wrote this ten minutes ago, I know it is correct." | Then you are recalling, not reviewing. Write the contract down first and re-derive the answer from the diff — the reasoning that produced the bug is the reasoning you are about to re-read. |
| "I will ask a subagent to confirm my read." | Asking for confirmation gets you confirmation. Pass the artifact and the contract, withhold your conclusion, and ask it to find what is wrong. |
| "I found nothing, so there is nothing to report." | Then say what you looked for and dismissed, in `## Deliberately Left Alone`. An empty review is indistinguishable from a review that never happened. |

## Red Flags

Signs the review is not one:

- You wrote the verdict before the first finding.
- You are reviewing your own diff and never wrote the contract down.
- You handed a subagent your conclusion and asked whether it agreed.
- Every finding is `P3`, on a change that touched auth, money, or a migration.
- You reported "tests pass" from the story text instead of from a verify you ran.
- The review is all findings and no `## Deliberately Left Alone` — nothing was
  considered and consciously kept, which usually means nothing was considered.

## Review Bias

- Prefer concrete behavioral issues over style opinions.
- Avoid proposing broad rewrites unless the current change is unsafe.
- Call out both overengineering and underengineering.
- Verify tests match the story, not just that tests exist.

## Verification

Before delivering the verdict:

- [ ] On your own diff, the contract was written down before the diff was read.
- [ ] Every finding cites a file and a line. A finding with no location is an opinion.
- [ ] The verdict is `pass` or `fail` — not "looks good with some notes".
- [ ] Where the suite is the evidence, `ai-flow verify` was run in this session and
      its output read. A result reported by the author was not taken on trust.
- [ ] The Deep section ran for every dimension the change's risk warranted, not
      only the quick checklist.
- [ ] What was considered and dismissed is in `## Deliberately Left Alone`, so a
      reader can tell it from what was never looked for.

A box you cannot point at output or written text for is not ticked.

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
