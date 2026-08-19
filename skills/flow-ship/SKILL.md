---
name: flow-ship
description: Push the current branch and open or update one pull request against the base, with the latest verify evidence attached to the PR body. Use when a story is verified and ready for review or merge. Wraps `ai-flow ship`; it is idempotent (one feature = one branch = one PR) and refreshes the proof without overwriting the human text of the description.
---

# Ship

## Overview

`ship` takes the verified work on the current branch and turns it into one pull
request: it commits whatever is dirty, pushes the branch, and opens (or updates) a
single PR against the base, attaching the latest `verify` evidence so a reviewer
sees the proof, not a promise. It is the last step of a story — run it after a
green verify.

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
- `--draft` — open the PR as a draft (never auto-merged).
- `--web` — open the PR in the browser afterward.
- `--no-evidence` — do not attach the latest verify evidence.
- `--no-commit` — do not auto-commit a dirty tree; push existing commits only.
- `--auto-merge` / `--no-auto-merge` — override the project's `autoMergeEpic`
  config for this run (see Auto-Merge below).
- `--merge-method <merge|squash|rebase>` — merge strategy when auto-merging
  (default: `merge`).
- `--dry-run` — show what would happen without pushing.

## Behavior

- **One feature = one branch = one PR.** Idempotent: if the PR already exists, the
  push updates it — nothing is recreated.
- It keys off the current **branch**, so it works the same inside a worktree or a
  normal checkout.
- The evidence section of the PR body sits between hidden markers and is replaced on
  each run; the human-written text around it is never overwritten.

## Auto-Commit

A dirty tree is committed before it is pushed, so `ship` really is the last step of
a story instead of requiring a manual commit first. The commit message is generic:
the title of the story linked to the current branch, or the branch name otherwise.
Before committing, `ship` runs the same secret/sensitive-file scan as
`ai-flow harness check --quick`; if that scan finds an issue, `ship` stops without
committing or pushing — fix it (or commit by hand) and ship again. Skip this with
`--no-commit`.

## Auto-Merge

Off by default (`autoMergeEpic: false` in `.coding-flow/config.json`). When on,
`ship` merges the PR itself via GitHub's native auto-merge, but only once every
story of the current branch's epic has an actual captured **green verify** — a
single unfinished or unproven story keeps the whole epic's PR open. This checks
recorded evidence directly, not the story's `## Status` line: a written "done"
normally overrides the machine signal everywhere else in the tool (a human
override must stick), but a PR merging itself into the base branch is the one
decision that must not rest on prose alone — an agent that writes "done" without
having run anything does not clear this gate. Auto-merge is also never attempted
on a draft PR or a PR that conflicts with the base: conflicts are a human's call,
not something `ship` resolves. Nor is it attempted while an earlier story in the
same epic (by directory name, e.g. `story-01-01-...` before `story-01-02-...`)
still has an open PR: story branches are cut independently from the base, so
GitHub would happily merge a later, enriching story before the foundation it
builds on has landed — `ship` waits for that earlier PR to merge first instead.
`--auto-merge` / `--no-auto-merge` override the config for one run.

## Before Shipping

- Confirm the story is verified: a green `ai-flow verify` should exist, so the
  attached evidence reflects a passing run. Do not ship a red or unproven story.
- Confirm you are on the feature branch for this work, not the base branch.

## Verification

Before reporting the story as shipped:

- [ ] A green `ai-flow verify` for this story exists — checked, not assumed.
- [ ] `ai-flow ship` ran and its output was read.
- [ ] The PR URL was reported, or the compare URL when `gh` was unavailable.
- [ ] Whether verify evidence was attached was stated either way, rather than
      left for the reviewer to notice.

If the secret scan stopped the auto-commit, the story is **not** shipped. Report
the finding; committing by hand to get around the scan defeats the only check
standing between a secret and a public branch.

## Output

Report what happened: the branch pushed, the PR URL (opened or updated), and whether
verify evidence was attached. If `gh` was unavailable, surface the printed compare URL.
