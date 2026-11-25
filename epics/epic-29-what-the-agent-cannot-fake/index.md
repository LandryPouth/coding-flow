# Epic 29 — What the agent cannot fake

## Goal

The lines an agent adds are checked by the CLI, not by the agent's word:
placeholders, invented imports and a forgotten `.only` are found in the diff;
a test it changed is proven to run and a test it removed is declared; and a
destructive command waits for the human.
Everything is deterministic, zero-dependency, and lives in `ai-flow`, because
a CLI with an exit code is harder to talk around than a skill paragraph.

## Why

- **The maintainer asked for it (2026-11-14)** after a study of two tools:
  "reprends tout ce que tu peux reprendre et trouver intéressant … passe
  principalement par le CLI, car c'est plus sûr qu'un skill".
- **Shipmoor** (shipmoor.dev, closed source, $19/month): a local
  verification layer. What is worth taking: a deterministic scan of the
  defects agents produce (`phantom_dependency`, `placeholder.*`, `trust.as_any`,
  `trust.ts_ignore`, `debug.console`, `unreachable_code`), reported only on
  introduced lines (`diff.only_introduced`); an agent harness on Claude Code's
  `PostToolUse` and `Stop` hooks with three modes (`observe`, `feedback`,
  `block`), `max_feedback_cycles` = 3 and silence when the tool itself fails;
  test evidence that never trusts an exit code alone, requires a changed test
  file to be among the collected tests, and flags test ids removed since the
  base (`reduced`) unless a removal record gives a reason; and the rule "AI
  advises, evidence decides: a model can subtract trust, never grant a pass".
- **agentic-os** (github.com/KbWen/agentic-os, MIT): a governance layer close
  to Coding Flow's own shape (risk classes, phases, work log, single-writer
  locks, ship gate). Its own README admits its validator checks that a proof
  is *written*, not that it is *true* — Coding Flow's executed `verify` is
  already stronger there. What is worth taking: a **destructive command gate**
  (`rm -rf`, `git reset --hard`, `git clean -fdx`, force pushes, piping a
  download to a shell: deny by default, blast radius and rollback first) —
  which agentic-os can only state as advisory ("only an operator-owned
  harness wrapper can intercept"), and which Coding Flow's `guard` *is*; and a
  **confidence gate** (the agent declares its confidence; low escalates).
- **Measured on bethl before planning.** The interim prototype
  (`~/.claude/workflows/lib/proof-scan.mjs`, run by the `epic-run` workflow
  since 2026-11-14) found, over bethl's last 60 commits, **29 changed
  integration test files that no verify command runs**
  (`apps/api/test/integration/*.integration-spec.ts`, outside jest's
  `testRegex`). Story 43-01's independent review had found the same thing by
  hand (P2-7: two ticked criteria proven only by a test run by hand). It also
  found one import neither declared nor installed
  (`scripts/design-system-pdf.mjs` → `@playwright/test`).

## Scope

**In scope**

- `ai-flow scan`: four defect rules on the lines a diff adds, in verify as a
  contrary signal.
- Changed tests proven collected, removed tests declared.
- Destructive commands refused by the guard, with the safe alternative.

**Out of scope (Later)**

- **Cut on 2026-11-14, the maintainer judged the first plan overkill**:
  `PostToolUse`/`Stop` harness hooks with three modes and a feedback cap
  (verify and the independent review already hold a story before it is
  done; a second gate inside the agent's loop is machinery for a solo
  user), and a declared confidence line (a model's self-assessed certainty
  is a weak signal). Style rules (`any`, `@ts-ignore`, `console.log`, `TODO`,
  empty `catch`) stay the linter's job. Reopen the hooks only if a driven run
  (20-01) is seen declaring itself done on a blocker verify would catch.
- An attestation export in the SLSA verification-summary format
  (`predicateType: https://slsa.dev/verification_summary/v1`) — useful for
  teams with an attestation pipeline, not before 24.
- Blast radius: criteria and docs pinned to the code they describe, flagged
  "suspect" when only one side moves (Shipmoor `links.yaml`).
- SARIF output for code scanning; a watch mode; Python and Go rule sets; a
  registry lookup to tell an invented package from an undeclared one over the
  network.
- A model judge of weakened assertions (Shipmoor samples 5 times, flags at
  4 of 5): 19-07 makes base tests read-only in driven runs, which removes the
  move instead of judging it.
- agentic-os's session identity (model name in each receipt) and handoff
  block: covered by 18 (journal) and 27 (holds, decision packets).

## Backbone

The agent's diff is scanned for the defects a linter lets through → verify
proves the changed tests ran and the removed ones were declared → a
destructive command never ran without the human.

The three stories are independent (disjoint files: `scan.js`,
`coverage-gate.js` test collection, `guard.js`).

## Stories

1. [story-29-01-the-diff-is-scanned](story-29-01-the-diff-is-scanned/spec.md) — `ai-flow scan`: four defect rules on introduced lines, in verify and evidence *(STANDARD — walking skeleton)*
2. [story-29-02-a-changed-test-runs-and-a-removed-test-is-declared](story-29-02-a-changed-test-runs-and-a-removed-test-is-declared/spec.md) — collected tests, removed test ids, exit code never trusted alone *(STANDARD)*
3. [story-29-03-destructive-commands-wait-for-the-human](story-29-03-destructive-commands-wait-for-the-human/spec.md) — guard refuses destructive commands and names the safe one *(STRICT — guard)*
4. [story-29-04-commands-built-to-evade-the-guard](story-29-04-commands-built-to-evade-the-guard/spec.md) — interpreter strings, git alias values, written-then-run scripts; the unread forms stated with their cover *(STRICT — added 2026-11-24 from 29-03's four reviews)*
5. [story-29-08-auto-merge-waits-for-the-checks](story-29-08-auto-merge-waits-for-the-checks/story.md) *(STRICT — writes the repository's branch protection; maintainer, 2026-11-25)*

## Decisions

- **Introduced lines only.** A finding counts only if its line was added by
  the diff under proof. Old debt is `recover`'s job (14), not a story's.
- **A contrary signal, like the others.** Scan findings follow
  design-decisions entry 9's direction rule: listed every time, lowering the
  verdict to NOT PROVEN only where the project asked for strictness
  (`mode: strict`, `failOnContrarySignals`, driven runs). Never a pass.
- **Heuristics say so.** Rules are line-aware regexes plus manifest
  resolution (what Shipmoor ships for TS/JS). Each finding names its rule;
  `ai-flow scan --explain <rule>` prints what it matches and why it can be
  wrong. Suppression is in the code, with a reason, and copied into evidence.
- **The tool failing never passes a story** (verify: `not examined`).
- **18-06 keeps the criteria binding.** Its spec gains Claim Check's verdict
  words and a next action per criterion; no second binding is built here.
- **Proven first by hand.** The `epic-run` workflow runs the prototype on
  every story from 2026-11-14 (training ground), so rules and noise are seen
  on real stories before this epic is built.

## Dependencies outside this epic

`guard.js` (29-03), `coverage-gate.js`
(contrary signals, `scanTestWeakening`), `diff-scope.js` (added lines),
19-01 (parsed runner output, for 29-02).

## Delivery order

29-01 and 29-03 with step 0 of `docs/plans/autonomous-factory.md` (no factory
needed). 29-02 after 19-01, before the first driven run (20-01).

## Readiness

`ready`.

## Maintainer cleanup on delivery

- [ ] Remove the proof gate from the `epic-run` workflow and skill
  (`~/.claude/workflows/epic-run.js` "Proof gate", `~/.claude/skills/epic-run/SKILL.md`
  step 2, `~/.claude/docs/skills/epic-run.md` section "Porte de preuve") and
  `~/.claude/workflows/lib/proof-scan.mjs` once 29-01, 29-02 and 18-06 ship;
  the workflow then calls `ai-flow scan` and reads verify.

## À faire côté utilisateur

_(filled by the stories)_
