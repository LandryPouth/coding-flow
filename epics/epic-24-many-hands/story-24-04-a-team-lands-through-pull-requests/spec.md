# Story 24-04 — A team lands through pull requests

## User Value

With `land: pr`, a finished chain is pushed and opened as one pull request
(through `ship`) instead of being merged locally, its shared lock is held
until the PR merges or closes, and the epic report links the PRs — the team
mode the maintainer asked for. bethl keeps `land: local` (memory: land is a
local merge, never push or PR without asking).

## Requirements

- `config.json` `land: local | pr` (default `local`).
- With `pr`: autoland/land call `ship` for the chain's branch (one feature =
  one branch = one PR, idempotent), body carries the local evidence (as
  today) marked "claim — runner verify pending" when 24-05 is configured.
- Locks (24-03) stay held while the PR is open; `ai-flow sync` (or `status`)
  checks PR state via `gh` and releases locks of merged/closed PRs, recording
  `worktree.land` with `via: pr` on merge (18-02 proof carry still applies).
- Driven runs never push without `land: pr` set by the project.
- Epic report (20-07) lists PR links and states.

## Acceptance Criteria

- [ ] Given `land: pr` and a finished chain, when autoland runs, then `ship`
      is called once and no local merge happens.
- [ ] Given `land: local`, then nothing is pushed.
- [ ] Given a merged PR (stubbed `gh`), when `sync` runs, then the lock is
      released and a land event recorded.
- [ ] Given the epic report, then PR links appear.

## Edge Cases

- `gh` missing or unauthenticated: the land refuses with the `gh auth login`
  hint; the chain stays finished, not lost.

## Out of Scope

- Merging the PR (human or the forge's rules).
