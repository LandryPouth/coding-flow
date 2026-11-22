---
name: flow-review
description: Review a diff before merge against project rules, architecture, tests, security, and story acceptance criteria — findings first, ranked by severity, each grounded in a file and line. Use when asked whether a change is safe, to catch blocking issues, or to check the work before a pull request goes out. Runs as a quick checklist by default; each dimension has an opt-in deep section for refactors, cross-module change, and high-risk work.
---

# Review

## Overview

You are the pre-merge reviewer. **Findings come first**, ranked by severity, each
grounded in a file and line, judged against this project's architecture and
conventions, not a generic ideal. Lead with what could break behavior, degrade
architecture, weaken tests or open a security hole; call out over- and
under-engineering alike, and propose a broad rewrite only when the change is unsafe.
Deterministic quality (lint, format, typecheck, duplication detectors) runs as
executed proof through `ai-flow verify`; you cover the judgment a linter cannot.

Each dimension is a quick checklist by default and goes **Deep** for a refactor, a
cross-module change, a new pattern or high-risk work. When the calling context's risk
tier already resolved STRICT (`scoreDiffRisk`/`scoreStoryRisk` returned `high`),
Architecture, Tests, and Security default to their **Deep** sections without
re-judging risk. A QUICK/STANDARD diff is unaffected: the quick checklist stays the
stated default there. Depth scales inside this one independent pass, not parallel
subagents fanned out one per dimension: each re-reads the full diff and contract, so
cost multiplies roughly per dimension added that way. `/code-review ultra` remains
available as an explicit, separately-invoked path when that coverage is worth it.

## Conventions

- Read `RULES.md`, the relevant `docs/` and the story files before claiming. Cite
  files and lines; treat missing validation evidence as a risk and an unrun command
  as an evidence gap.
- Strict project: no acceptance criterion may stay open without `[~]` or a
  `## Deferred Criteria` entry, and every deleted test file is named in a
  `## Test Exemption` — `verify` fails on both.
- Never trust a reported result: when `ai-flow` is present, run
  `ai-flow verify --story <dir>` and read the evidence. If it reports `REFUSED` (commands from `plan.md`, nobody watching), stop
  and tell the user — never add `--allow-plan-commands` yourself; the guard refuses
  it, and the grant is theirs to give.

## Reviewing Your Own Diff

Most often this runs minutes after the same agent wrote the code, with the reasoning
that produced any defect still in context — re-reading it reproduces the same
conclusion. Review the **artifact** against the **contract**, never against your
reasoning:

- The **artifact** is the diff and the code it lands in — not your plan, your
  summary or the commit message.
- The **contract** is the request the story came from (its user value, or the
  user's own words), its acceptance criteria, `RULES.md`, and the conventions
  already in the codebase. Write it down *before* you open the diff — a contract
  derived after reading the change is a description of the change.
- Then re-derive whether the artifact satisfies the contract. "I remember deciding
  this was right" is recall, not review.

Two rules follow:

1. **No verdict first.** Writing "this correctly handles the empty case" before
   checking turns every later read into a search for confirmation.
2. **Delegate the artifact and the contract only** — never your reasoning, never
   "can you confirm". A reviewer given your conclusion returns your conclusion.
   Frame it adversarially: find what is wrong, assume the author is overconfident.

A diff someone else wrote needs neither rule: your context there is fresh.

## Severity

- `P0`: production-breaking or unsafe — fix before continuing.
- `P1`: fix before merge.
- `P2`: fix soon, or document as a deliberate tradeoff.
- `P3`: optional.

## Workflow

1. Find where the work is: a story shown in `ai-flow status` with `→ wt: <path>` is
   read, diffed and verified there (`cd <path>`), and its `RULES.md`, docs and story
   files are read there too. Never conclude a story is unimplemented from this
   checkout's copy.
2. Inspect the changed files and the code around them.
3. Check the diff against what was asked, before the dimensions below, so that
   well-written code cannot stand in for the right code. Quote the criterion or the
   request line in each finding, and tag it `[spec]`:
   - a criterion missing, or only partly met;
   - a criterion that looks met but behaves wrong;
   - user- or API-visible behavior that no criterion and no request line asks for;
   - a criterion that settles a question the request left open, with no
     confirmation recorded in the story — the proof would prove the plan, not the
     request.

   Severity ranks `[spec]` findings with the rest: a `[spec]` P1 blocks like any P1.
4. Cover each dimension below at the depth the risk warrants.
5. **A mechanical finding ships its check.** When a tool could catch the defect — a
   banned API, an import across a boundary, a file in the wrong place, a forbidden
   dependency — the fix names the check that would have caught it: a rule in the
   project's own linter or dependency config, or a test, declared in
   `.coding-flow/config.json` `validation.quality` so `verify` runs it (a tightening,
   reported as `policy-changed` like any change to the bar). The next agent then
   meets a failing command instead of a reviewer. Only judgement calls become
   written rules in `RULES.md` or `docs/conventions.md`.
6. Separate blocking from non-blocking; give a pass/fail verdict.

## Architecture

Check module boundaries, data flow, where business logic lives, service/repository
usage, type safety, validation boundaries, naming consistency, and decisions that
should be recorded. Drift signals: UI owns business rules; data access leaks into
presentation; validation is duplicated or only client-side; shared modules import
feature-specific code; the story adds a second way to do an existing thing. Two
tests for a new abstraction:

- **Deletion test** — delete it in your head. If its complexity vanishes, it was a
  pass-through and costs callers a layer for nothing; if the complexity reappears in
  its callers, it earns its place.
- **One adapter is a hypothetical seam.** An interface meant to be swapped, with a
  single implementation behind it, is speculative until a second one exists.

**Deep (refactor, cross-module, new pattern):** trace data and control flow through
the change and judge whether it becomes the codebase's new normal. Meaningful
decisions belong in `plan.md`. Prefer small corrective refactors over a redesign.

## Tests

Build a coverage matrix: per acceptance criterion, the evidence
(unit/integration/E2E/manual/none), its strength (strong/weak/brittle/excessive) and
the action required. Flag a test that cannot fail (a tautology, or re-asserting a
mock you just set), assertions on implementation details instead of behavior,
over-mocking that fakes the behavior under test, and flaky or order-dependent tests.

**Deep (critical flows, complex logic, release-sensitive, flaky suites):** run
`ai-flow verify` and read the evidence. Each critical criterion needs **negative
evidence**: breaking the behavior makes its test fail for the expected reason,
restoring it makes it pass. For a bug fix run with `verify --red-at-base`, read
`redAtBase`: `ok` with `baseExit ≠ 0` and `headExit = 0`. A test that passes at base,
or fails there only because it never reached its tests (a missing module, a syntax
or build error), is not negative evidence; without it, coverage is unproven whatever
the run says. Block on: risky logic with no test; permission or security behavior
with no test; a critical journey with no E2E/manual evidence; failed validation with
no documented cause.

## Security

Client validation is not security validation; public/admin boundaries must be
explicit. Check authentication, authorization boundaries, server-side validation,
secret exposure, injection, admin/public data leakage, unsafe uploads or external
content, and error messages that leak details. Strict on server-side enforcement,
practical on low-risk UI-only work.

**Deep (auth, permissions, payments, uploads, secrets, external integrations,
sensitive data):** treat user-controlled input as hostile. Name the assets, actors,
privileged actions and trust boundaries; read the changed code and the adjacent
auth/data paths. Block on: missing server-side authentication or authorization; user
input reaching persistence or execution unvalidated; secrets or private data that
can leak; admin-only data exposed publicly; errors that reveal sensitive details.

## Quality

Advisory only — never edit code here. Quality means **context efficiency**, not
style: duplication of one concept, tangled coupling and runaway complexity widen the
blast radius of the next story. Flag duplication clusters, high-complexity functions,
and drift from `docs/conventions.md`. Name the rest by Fowler's smells
(*Refactoring*, ch. 3), so the finding carries its fix:

| Smell | In the diff | Fix |
|---|---|---|
| Mysterious Name | a name that does not say what it does or holds | rename; if no honest name comes, the design is unclear |
| Feature Envy | a function reads another module's data more than its own | move it next to that data |
| Data Clumps | the same few fields or parameters travel together | give them one type |
| Primitive Obsession | a bare string or number stands in for a domain concept | give the concept its own small type |
| Repeated Switches | the same `switch`/`if` cascade on the same value, in several places | one map or dispatch both sites share |
| Shotgun Surgery | one logical change forces edits across many files | gather what changes together |
| Divergent Change | one file edited for several unrelated reasons | split it so each part changes for one reason |
| Message Chains | `a.b().c().d()`, a walk the caller should not depend on | hide the walk behind one call |

A smell is a heuristic: write "possible Feature Envy", never "violation"; a
convention the project documents wins over the table.

**The DRY boundary:** two similar blocks are not yet a pattern (rule of three), and
duplication is cheaper than the wrong abstraction (Metz): a signal to review, never
an automatic defect. Recommend extraction only
when the cases are one concept that will change together; otherwise say so and leave
them apart. Every flag names a `file:line` and a concrete cost to a future story.

## E2E (opt-in, for critical journeys)

For auth, admin CRUD, checkout/payment, publishing and permission-sensitive flows:
the smallest set of journeys that protects critical value — one happy path plus one
important failure path, stable selectors, behavior-level assertions. Check the
persisted or user-visible result, not a click sequence. Commands and expected results
go in `plan.md`.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "The suite is green, so the tests are fine." | Green proves the commands passed, not that a test would catch a regression. Require negative evidence for each critical criterion. |
| "The author says it was tested." | Run `ai-flow verify --story <dir>` yourself and read the evidence. |
| "The criteria are all ticked, so it does what was asked." | Criteria are the plan's reading of the request. Read the request too: behavior nothing asked for, or a criterion that chose between two readings with no confirmation, is a `[spec]` finding. |
| "These two blocks are identical, extract them." | Rule of three, and duplication over the wrong abstraction — unless they are one concept that will change together. |
| "There is no test for this, so it is a blocker." | Only if the behavior carries risk: permissions, validation and money earn a test; copy and layout do not. |
| "The diff is clean, I can approve without reading the surrounding code." | Drift is only visible against what was already there. |
| "I'll flag the style issues too, they're quick." | Linters run as executed proof; style noise buries the judgment only you can give. |
| "I'll add a line to `RULES.md` so this does not happen again." | A rule an agent must remember is one it forgets under context pressure. If a tool can catch it, the fix is the check; prose is for judgement calls. |
| "I wrote this ten minutes ago, I know it is correct." | Then you are recalling. Write the contract down first and re-derive the answer from the diff. |
| "I will ask a subagent to confirm my read." | Asking for confirmation gets you confirmation. Pass the artifact and the contract, withhold your conclusion. |
| "I found nothing, so there is nothing to report." | Say what you looked for and dismissed, in `## Deliberately Left Alone` — an empty review looks like one that never happened. |

## Red Flags

Signs the review is not one:

- The verdict came before the first finding.
- You are reviewing your own diff and never wrote the contract down.
- You handed a subagent your conclusion and asked whether it agreed.
- Every finding is `P3`, on a change that touched auth, money or a migration.
- You reported "tests pass" from the story text instead of from a verify you ran.
- Every finding is about how the code is written; none asks whether it does what was
  asked.
- There is no `## Deliberately Left Alone` — nothing was considered and kept, which
  usually means nothing was considered.

## Verification

Before delivering the verdict:

- [ ] On your own diff, the contract was written down before the diff was read.
- [ ] Every finding cites a file and a line. A finding with no location is an opinion.
- [ ] The diff was read against the request and each criterion, and for behavior
      nothing asked for — not only against the rules.
- [ ] The verdict is `pass` or `fail` — not "looks good with some notes".
- [ ] Where the suite is the evidence, `ai-flow verify` ran in this session and its
      output was read.
- [ ] The Deep section ran for every dimension the risk warranted.
- [ ] What was considered and dismissed is in `## Deliberately Left Alone`.

A box you cannot point at output or written text for is not ticked.

## Output

```md
# Review

Verdict: pass/fail

## Findings

- [P1] `path:line` — issue, impact, fix
- [P2] [spec] `path:line` — the criterion or request line quoted, what the diff does instead, fix

## Required Fixes

## Non-Blocking Improvements

## Test Gaps

## Deliberately Left Alone

- duplication/pattern kept because the wrong abstraction would cost more

## Residual Risks
```

Then capture it as durable evidence, so a later session or the tool reads the verdict
without re-reading the diff:

```bash
ai-flow review capture --story <story-dir> --verdict pass|fail \
  --architecture quick|deep|skipped --tests quick|deep|skipped \
  --security quick|deep|skipped --quality quick|deep|skipped --e2e quick|deep|skipped \
  --p0 <count> --p1 <count> --p2 <count> --p3 <count> \
  [--reviewer self|subagent] [--accept "<reason>"]
```

- `--verdict` is this pass's Verdict line; `--p0`..`--p3` count its `## Findings` by
  severity (not `## Non-Blocking Improvements`).
- A dimension is `deep` if its Deep section ran, `quick` if only the checklist did,
  `skipped` if it was not covered (E2E is `skipped` unless the change is a critical
  journey).
- `--reviewer subagent` when this pass ran as a delegated, independent review;
  `self` (the default) otherwise.
- A `pass` with an open P0 or P1 is refused unless `--accept "<reason>"` is given —
  only with the user's agreement, never on your own. It is stored as `acceptedRisk`.

If `ai-flow` is not on `PATH`, use `npx @landry_pouth/coding-flow` instead.
