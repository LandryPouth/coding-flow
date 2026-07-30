---
name: ship
description: Push the current branch and open or update one pull request against the base, with the latest verify evidence attached to the PR body. Use when a story is verified and ready for review or merge. Wraps `ai-flow ship`; it is idempotent (one feature = one branch = one PR) and refreshes the proof without overwriting the human text of the description.
---

# Ship

## Overview

`ship` takes the verified work on the current branch and turns it into one pull
request: it pushes the branch and opens (or updates) a single PR against the base,
attaching the latest `verify` evidence so a reviewer sees the proof, not a promise.
It is the last step of a story — run it after a green `/verify`.

## Command

```bash
ai-flow ship
```

> If bare `ai-flow` is not on `PATH`, use `npx @landry_pouth/coding-flow ship`. Uses
> `gh` when available; without it, `ship` pushes and prints the compare URL to open
> the PR by hand.

Useful flags:

- `--base <ref>` — target branch (default: the remote's default branch).
- `--title <text>` — PR title (default: derived from the commits).
- `--draft` — open the PR as a draft.
- `--web` — open the PR in the browser afterward.
- `--no-evidence` — do not attach the latest verify evidence.
- `--dry-run` — show what would happen without pushing.

## Behavior

- **One feature = one branch = one PR.** Idempotent: if the PR already exists, the
  push updates it — nothing is recreated.
- It keys off the current **branch**, so it works the same inside a worktree or a
  normal checkout.
- The evidence section of the PR body sits between hidden markers and is replaced on
  each run; the human-written text around it is never overwritten.

## Before Shipping

- Confirm the story is verified: a green `ai-flow harness verify` should exist, so the
  attached evidence reflects a passing run. Do not ship a red or unproven story.
- Confirm you are on the feature branch for this work, not the base branch.

## Output

Report what happened: the branch pushed, the PR URL (opened or updated), and whether
verify evidence was attached. If `gh` was unavailable, surface the printed compare URL.
