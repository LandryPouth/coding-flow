# Story 21-06 — Escaped defects are traced

## User Value

`insights` counts what the gates let through: fixes that touched a story's
files within 14 days of its land, and incidents the maintainer recorded — the
Goodhart counterweight without which yield and autonomy would reward testing
less and asking less.

## Requirements

- Escape heuristic (labelled as such in output): a commit whose subject starts
  with `fix` (Conventional Commits) landed within 14 days after a story's land
  (`worktree.land` event or the merge commit) and touching ≥ 1 file the story
  changed → `escape.suspected` linking both.
- `ai-flow event incident --story <dir> --ref <url-or-id> [--severity]`
  records a confirmed escape.
- Rework: lines of a story's files rewritten within 14 days by another story,
  reported as a share.
- `insights` prints escapes per done story (suspected and confirmed apart) and
  rework; the yield line always shows the escape rate next to it.

## Acceptance Criteria

- [ ] Given a fixture repo where a `fix:` commit touches a story's file 3 days
      after land, then one suspected escape is linked to that story.
- [ ] Given the same commit 20 days later, then none is counted.
- [ ] Given `event incident`, then it is counted as confirmed.
- [ ] Given the yield line, then the escape rate prints beside it.

## Edge Cases

- A fix touching files of two stories: counted for both, flagged shared.
- Squash merges: land time from the event, else the merge commit date.

## Out of Scope

- Sentry or deploy integrations (later, once the event shape is proven).
