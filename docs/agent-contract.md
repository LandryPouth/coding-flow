# The agent contract

> What Coding Flow expects from a coding agent, stated once, agent-neutral. Every
> integration — the Claude Code skills today, Codex or OpenCode later — is a
> **translation** of this document into that agent's idiom. It is not a second
> place to put behaviour.

## Why this exists before the second agent, not after

The obvious way to support three agents is to write three sets of skills. That
gives you `3 agents × N skills`, each drifting on its own schedule, and the
product becomes whichever set you edited most recently.

The alternative is one protocol and three thin translations. It costs a document
now and saves a rewrite later, so it is written now — while there is exactly one
integration and the coupling is still cheap to see.

The test this document has to keep passing:

> Delete every skill in the repository. Does Coding Flow still enforce the same
> things?

If the answer is ever no, behaviour has leaked out of the CLI and into an
integration, and it belongs back in the CLI.

## The two halves

| | Guides | Enforces |
|---|---|---|
| **Integration** (skills, prompts, instructions) | ✅ | ❌ |
| **CLI** (`ai-flow`, the `guard` hook, CI) | ❌ | ✅ |

An integration teaches an agent to do the right thing. It cannot make it. An
agent can forget an instruction, misread it, be interrupted mid-task, use a
different command, or report a result it did not obtain. So the split is:

```
Agent:        "Tests passed."
Coding Flow:  Coverage: missing — 3 behavior file(s) changed and no test file did.
              NOT PROVEN.
```

Everything Coding Flow *promises* is on the enforcement side. Everything an
integration adds is convenience, sequencing, and good judgment — valuable, and
never load-bearing.

## The protocol

Four obligations. An integration is complete when it teaches all four; it is
correct when it adds nothing that the CLI would not also check.

### 1. Before implementation — inspect the work item

Read the unit of work before editing. Coding Flow does not care where that unit
lives: a story under `epics/`, a Spec Kit feature under `specs/`, or nothing at
all (a branch with a diff is a valid input — see `verify` with no `--story`).

The agent must not invent scope the work item does not carry.

### 2. During implementation — obey the repository's rules

`RULES.md` and existing code patterns win over generic preferences. Changes stay
scoped and reversible.

The `guard` hook enforces the part of this that is enforceable — writes to
blocked paths, secret content, and the common shell write forms. The rest is
guidance, and is expected to be imperfectly followed.

### 3. Before completion — run verification, and read what it says

```bash
ai-flow verify [--story <dir>]
```

Non-skippable. It executes the declared validation commands and captures the
result verbatim. Three outcomes an integration must be able to distinguish, and
must never collapse into "it failed":

| Outcome | Meaning | Correct response |
|---|---|---|
| **passed** | commands green, proof holds | continue |
| **NOT PROVEN** | every command passed, the coverage gate blocked | write the missing test, or declare an exemption with a reason |
| **FAILED** | a command exited non-zero | fix the code; never weaken the test |
| **tool error** | the harness could not observe the run | report it — this is not a red suite |

The coverage verdict is named by rung: `verified` (added lines measured and
executed), `evidence` (a test file moved, nothing measured), `exempted` (a human
wrote down why), `not-required`, `missing`. An integration must not report
`evidence` as if it were `verified`.

### 4. Before shipping — hand over the evidence

```bash
ai-flow ship
```

The proof travels with the change into the PR body. An agent may not declare a
unit of work done on its own authority: `## Status: done` is written **after** a
green verify exists for it, never as an assertion that one will pass.

## What an integration may and may not do

**May**: sequence the four obligations; choose an intensity from the risk of the
change; decide what to read first; phrase the failure messages in its own voice;
add repo-specific judgment.

**May not**:

- reimplement a check the CLI performs (it will drift, and the CLI's answer is
  the one that counts);
- weaken, skip, or reconfigure a gate to finish a task — including
  `requireTestChange`;
- report an outcome it did not obtain from the CLI;
- become a prerequisite for enforcement. `ai-flow init --minimal` installs the
  guard and the harness with **no** skills at all, and that install must remain
  fully enforcing.

## Building a new integration

The mechanics of detection and file layout live in
[`plans/multi-agent-install.md`](plans/multi-agent-install.md). This document
covers only what the integration has to *say*.

1. Translate the four obligations into the agent's instruction format.
2. Teach the outcome table above — especially NOT PROVEN, which is the outcome
   most agents will otherwise treat as a broken test.
3. Wire the `guard` hook into that agent's pre-tool-use mechanism, if it has one.
   If it does not, the CLI and CI still hold; say so rather than implying a
   protection that is not there.
4. Add a behavioural test proving the enforcement is unchanged **without** the
   integration installed.

Step 4 is the one that matters. It is also the architectural check: anything that
turns out to be hard to enforce without the agent is coupling that was hiding.

## The core stays boring

Two proposals recur, from opposite directions, and both are refused for the same
reason. They add state or indirection to the part whose whole value is being dumb
and deterministic.

**The guard stays one process per decision.** Making it a resident daemon that
the hook pings over a socket would take it from ~70 ms to ~3 ms. It is still
refused: the guard is fail-open by design, so a daemon that is dead, hung, or
serving a cached `harness.json` stops protecting *silently*, which is strictly
worse than the latency it saves. Add worktree-scoped socket lifecycles and a
locally reachable "may I write this?" endpoint and the security surface grows to
buy back time that is spent between two LLM turns anyway. Optimising the guard is
welcome; changing its execution model is not. The cheap wins — dispatching it
before the other modules load, keeping `crypto` off its path — are the shape this
is allowed to take.

**Policy never moves into a `SKILL.md`.** It is tempting to declare a skill's
expectations in its frontmatter (`evidence:`, `exit_conditions:`,
`min_patch_coverage:`) and have the CLI read them. That inverts this document: a
`SKILL.md` is agent-facing text the agent can edit, so an agent that lowers its
own threshold has defeated the gate while staying inside the rules. Thresholds
live in `.coding-flow/harness.json`, which is project configuration, not prompt.

The boundary in one line: **skills are behaviour, `harness.json` is policy.**
Behaviour is advisory and may be reworded freely; policy is enforced and changes
deliberately.

## Stability

The contract is stable and changes only with a deliberate, documented decision.

The integrations are not. Skills are agent-specific guidance and are **not** part
of Coding Flow's enforcement guarantees — `flow-run`, `flow-plan`, `flow-review`
and the rest may be reworded, split, or removed without that being a breaking
change to the tool. What may not change quietly is the behaviour of the CLI they
call.
