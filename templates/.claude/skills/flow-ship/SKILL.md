---
name: flow-ship
description: Push the current branch and open or update one pull request against the base, with the latest verify evidence attached to the PR body. Use when a story is verified and ready for review or merge. Wraps `ai-flow ship`; it is idempotent (one feature = one branch = one PR) and refreshes the proof without overwriting the human text of the description.
---

# Ship

## Overview

The last step of a story, after a green verify: `ship` commits whatever is dirty,
pushes the branch, and opens or updates one PR against the base with the latest
`verify` evidence attached, so the reviewer sees the proof, not a promise.

## Before Shipping

- A green `ai-flow verify` for this story exists — checked, not assumed. `ship` does
  not refuse a red or unproven story, so never run it on one.
- You are on the story's feature branch, not the base branch.

## Command

```bash
ai-flow ship
```

> If bare `ai-flow` is not on `PATH`, use `npx @landry_pouth/coding-flow ship`. With
> no `gh`, `ship` pushes and prints the compare URL to open the PR by hand.

Flags:

- `--base <ref>` — target branch (default: the remote's default branch).
- `--title <text>` — PR title (default: derived from the commits).
- `--draft` — open as a draft (never auto-merged). `--web` — open it in the browser.
- `--no-evidence` — attach no verify evidence.
- `--no-commit` — push existing commits only.
- `--all` — commit the whole dirty tree. By default, outside a story worktree, only
  the story's files are committed (its directory, files the branch already touched,
  new files beside them); the rest is listed as left out.
- `--auto-merge` / `--no-auto-merge` — override `autoMergeEpic` for this run;
  `--merge-method <merge|squash|rebase>` (default `merge`).
- `--dry-run` — show what would happen without pushing.

## Behavior

- **One feature = one branch = one PR**, keyed off the current branch, worktree or
  not. Re-running updates the PR; nothing is recreated.
- The evidence section of the PR body sits between hidden markers and is replaced on
  each run; the human text around it is never touched.
- **Auto-commit:** the message is the title of the story linked to the branch, or
  the branch name. The files about to be committed first go through the same
  secret/sensitive-file scan as `ai-flow harness check --quick`; a finding stops
  `ship` before it commits or pushes.
- **Auto-merge** is off by default (`autoMergeEpic: false` in
  `.coding-flow/config.json`). When on, GitHub's native auto-merge is armed only
  once every story of the branch's epic has a captured **green verify** — recorded
  evidence, never a `## Status` line, since a PR merging itself into the base must
  not rest on prose. It is never armed on a draft, on a PR that conflicts with the
  base (a human's call), or while an earlier story of the same epic (by directory
  order) still has an open PR: a later story must not land before the foundation it
  builds on.

## Verification

Before reporting the story as shipped:

- [ ] The two Before Shipping checks held before `ship` ran.
- [ ] `ai-flow ship` ran and its output was read.
- [ ] The PR URL was reported, or the compare URL when `gh` was unavailable.
- [ ] Whether verify evidence was attached was stated either way.

If the secret scan stopped the auto-commit, the story is **not** shipped. Report the
finding: committing by hand to get around the scan defeats the only check between a
secret and a public branch.

## Output

The branch pushed, the PR URL (opened or updated) or the compare URL, and whether
verify evidence was attached.
