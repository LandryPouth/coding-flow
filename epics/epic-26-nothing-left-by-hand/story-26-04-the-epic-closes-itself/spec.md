# Story 26-04 — The epic closes itself

## User Value

When the last story and the epic review are done, the run finishes the
epic the way the orchestrator did by hand on every bethl epic: closure
notes written, project context and roadmap updated where the project's
state changed, docs checked, the moved base merged and re-verified, the
epic landed, its worktrees and servers gone — and the maintainer reads one
report instead of doing it.

## Requirements

- **Closure process** (role `closer`, fresh, edits only Markdown under
  `epics/<epic>/`, `docs/`, `CHANGELOG.md`): given the epic diff, the
  index, `REPORT.md` and the `docs check --changed <base>` output (26-03),
  it writes:
  - a `## Closure` section in the epic index: delivered, deviations from
    the plan, follow-ups, maintainer to-dos left;
  - `docs/project-context.md` and the roadmap only where the current state
    changed (the project's context boundary rules apply);
  - fixes for the docs check findings on files the epic touched;
  - one CHANGELOG entry for the epic.
  Committed on the epic branch as one `docs(epic-NN): closure` commit; the
  CLI checks it touched only allowed paths, else it is reverted and listed.
- **Land through the base queue** (24-07), for every epic, alone or not:
  if the base moved since the fork, merge it into the epic branch in a
  scratch worktree, run verify (all required tiers) on the result; green →
  `land` per `land` (`local`: `--no-ff` merge, `pr`: 24-04); red or a
  conflict → parked with `Needs you` (26-02 notifies).
- **Cleanup** after a land: the epic's worktrees and branches removed,
  servers started through `ai-flow serve` stopped (24-01), the run
  registry entry closed (24-07).
- Never pushes when `land: local`; never touches `main`.

## Acceptance Criteria

- [ ] Given an epic whose stories and review are done, then a closer runs
      and one closure commit adds the index `## Closure` section and a
      CHANGELOG entry.
- [ ] Given a closer that edits a source file, then that change is reverted
      and listed in the report.
- [ ] Given a base that moved since the fork, then the base is merged in a
      scratch worktree and verified before the land; given it red, then the
      epic is parked and the base is unchanged.
- [ ] Given a green land with `land: local`, then the base has one `--no-ff`
      merge, the epic's worktrees and branches are gone, and nothing was
      pushed.
- [ ] Given docs check findings on files the epic changed, then the closure
      commit fixes them or the report lists them.

## Edge Cases

- No `docs/project-context.md`: the closer skips it, says so.
- An epic with a deploy-coupled story deferred (`Owner: human`, e.g. a
  column DROP): the epic lands without it; the to-do stays listed.

## Out of Scope

- Deploying, tagging, releasing.

## Security

- The closer cannot edit code (path allowlist enforced by the CLI after the
  fact, and its tools exclude `Bash`).
- Merges only through the base queue's verify; never `--force`.
