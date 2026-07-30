---
name: verify
description: Run the declared validation commands for a story and capture verbatim pass/fail as tamper-evident proof. Use when you need to prove a change actually passed — not self-report that it did — or to understand the evidence the harness writes. Wraps `ai-flow harness verify`; the captured exit codes are the story's source of truth, and `/run` and CI both gate on them.
---

# Verify

## Overview

`verify` is the proof step of the workflow. It executes the story's declared
validation commands, records their real exit codes, and writes a content-addressed
evidence file. Nothing here trusts a self-reported "tests pass" — the captured
result is the pass/fail of record. `/run` calls it automatically; use `/verify`
directly when you want the proof on demand, or to explain what the evidence means.

## Command

```bash
ai-flow harness verify --story epics/epic-NN/story-NN-NN-name
```

> If bare `ai-flow` is not on `PATH`, use `npx @landry_pouth/coding-flow harness
> verify --story <dir>`. Add `--json` to print the evidence, `--dry-run` to show what
> would run without executing.

- Exit `0` = every declared command passed. Exit `1` = a command failed, or no
  validation commands were found (no command means not verified, which is a failure).
- Each run writes `.coding-flow/runs/<timestamp>-verify.json` with the commands, their
  exit codes, timing, an environment fingerprint (node, platform, arch), and the
  lockfile hash when present — so the proof is reproducible and hard to fake.

## Where Commands Come From

`verify` resolves the commands to run, in order:

1. `.coding-flow/config.json` → `validation.commands` (the primary source).
2. Fallback: the story `plan.md` `## Commands` fenced block.

If neither yields a command, `verify` fails loudly rather than passing silently.
Declare the real project commands (typecheck, lint, test, e2e) in one of those places.

## How The Proof Is Used

- **Status:** `ai-flow status` reads the latest verify — green shows the story as
  `verified`, red as `blocked`. A `## Status` line in `tasks.md` may override it, but
  `## Status: done` is only honest after a green verify.
- **Ship:** `ai-flow ship` attaches the latest evidence to the PR body.
- **CI:** a generated workflow replays a pinned verify so the gate is non-gameable.
- **Trace:** `ai-flow trace` links the evidence to the story's acceptance criteria.

## Rules

- Treat any unrun command as an evidence gap, not a pass.
- Fix real failures at the root; never weaken or delete tests to get green.
- For a risky criterion, pair verify with a demonstrated red→green so the green run
  actually proves the behavior.

## Output

Report the verdict plainly: which commands ran, their exit codes, and the path to the
written evidence file. On red, name the failing command and what it reported.
