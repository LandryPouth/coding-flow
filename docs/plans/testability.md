# Production-grade testability (anti AI-slop)

Goal: make "it works" no longer an **agent claim** but **reproducible evidence,
proven negatively, and executed out of its hands**. This document describes the
three levers added and why.

## The problem specific to AI workflows

In a classic project, a green CI is trustworthy because the tests are a
specification **independent** of intent, written by a human. Here, the same AI
writes the code **and** the tests. A green on tests written by the agent that
wrote the code proves almost nothing: tautological tests, over-mocked, that
mirror the implementation, or "teach to the test". "Auto-run + gate on green"
**amplifies** this bias instead of correcting it.

## Lever 1 — Non-fakeable execution: `ai-flow harness verify`

`harness evidence` captures the diff + the security scan but **does not run** the
test suite. `harness verify` actually executes it:

- **Source of the commands** (decreasing priority): `config.validation.commands`,
  then the `## Commands` block of the story's `tests.md`, then the usual
  `package.json` scripts (`typecheck`, `type-check`, `lint`, `test`).
- **Runs** each command (`spawnSync`, shell, 10 min timeout), **captures
  verbatim** exit code + outputs (truncated) into `.coding-flow/runs/*-verify.json`.
- **Fails (exit 1)** if a command breaks **or if no command ran**: "nothing
  executed" is not "verified".
- `--dry-run` prints the plan without executing anything; `--json` outputs the
  raw evidence.

The evidence JSON is the truth, not the agent's narrative. To make it fully out
of its hands, the clean-room CI remains the ultimate gate (see below).

Declarative, language-independent commands:

```json
{ "validation": { "commands": ["pnpm typecheck", "pnpm test", "pnpm e2e"] } }
```

## Lever 2 — Negative proof (in the skills)

A test that can never fail proves nothing. The skills now require, for each
**critical** acceptance criterion, a **demonstrated red→green**: break the
behavior (revert/injected fault) → the guard test turns red for the right reason
→ restore → green. Recorded in `implementation-notes.md`.

Mutation testing is the "ceiling" version (mutation score): reserved for
critical **modules**, as an opt-in recommendation, because of its cost — not a
default.

## Lever 3 — Anti-slop discipline + independent verifier (in the skills)

- `blueprint-tests`: "Production-Grade Bar" (rejects tautologies, over-mock,
  tests that mirror the implementation, catch-all snapshots, flaky/order-dependent,
  coverage padding) + `criterion -> file::test` traceability + negative proof. The
  generated `tests.md` template carries a traceability table and a negative-proof
  checklist.
- `tests-check`: "Anti-Slop Quick Flags" + pointer to `harness verify`.
- `agent-validator-tests`: blocking anti-slop conditions, **independent
  execution** (reruns itself, judges from story + diff, not from the
  implementer's reasoning), negative proof required.
- `implement-slice` / `run-story` / `run-story-secure`: call `harness verify`
  after implementation; a failure is a blocker, not something to work around.

## Cost & budget ($20 plan)

- **Disk space: negligible** (evidences = small JSON files).
- **The real cost = tokens/agent passes.** So: negative proof on the *critical*
  criteria, mutation on the *critical* modules, independent verifier for the
  *release-sensitive* — never per-story.
- **Let the CI carry the heavy gate** (free GitHub compute): trust ↑ and Claude
  budget ↓, since the agent no longer has to re-run everything itself.

## Files

| File | Role |
| --- | --- |
| `bin/lib/harness.js` | `verify`: command resolution, execution, verbatim capture, evidence, gate |
| `bin/lib/config.js` | Declarative `validation.commands` field |
| `bin/lib/commands.js` | Help: `verify` subcommand |
| `templates/.claude/skills/blueprint-tests` | Production bar, negative proof, traceability, `tests.md` template |
| `templates/.claude/skills/agent-validator-tests` | Anti-slop, independent execution, negative proof |
| `templates/.claude/skills/tests-check` | Anti-slop quick flags + verify pointer |
| `templates/.claude/skills/{implement-slice,run-story,run-story-secure}` | Wiring of `harness verify` |
| `test/harness-verify.test.js` | 6 contract tests (real execution, failure, no command, dry-run, tests.md, parse) |

## Out of scope (deliberate)

- **Being the universal test-runner**: the tool runs the commands *declared* by
  the project, it does not invent a framework nor reimplement mutation testing.
- **Scaffolding the CI into the target apps**: possible later (Actions template +
  diff-coverage floor), but not in this slice.
