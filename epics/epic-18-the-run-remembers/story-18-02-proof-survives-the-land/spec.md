# Story 18-02 — Proof survives the land

## User Value

When a story's worktree is landed or removed, its verify, review and evidence
records and its journal lines are carried into the primary checkout first. A
finished story keeps reading `verified` (or honestly `stale`), never
`written; no verify captured`, and an unattended epic's report is not a list
of `in-progress` stories.

## Requirements

- `worktree land`, `worktree autoland` and `worktree remove` copy, before
  deleting anything, every `.coding-flow/runs/*.json` and every
  `.coding-flow/*.jsonl` line written in the worktree that the primary does
  not already hold, into the primary's `.coding-flow/`.
  - `runs/*.json`: copied by file name (timestamped names do not collide;
    an identical existing file is skipped; a different file with the same
    name is renamed with a suffix and reported).
  - `events.jsonl`, `denials.jsonl`, `guard-unchecked.jsonl`: lines appended
    in time order, duplicates (byte-identical lines) dropped.
- Evidence keys are portable story paths, so copied proof resolves in the
  primary without rewriting.
- Where the project tracks `.coding-flow/`, `init`/`upgrade` add
  `merge=union` for `.coding-flow/*.jsonl` to `.gitattributes` (idempotent),
  so two branches appending never conflict (bethl: `guard-unchecked.jsonl`
  conflicts at every merge).
- A land event (`worktree.land`, files carried, count) is appended once 18-05
  exists; this story only needs the carry to happen.
- The land output names how many proof files and journal lines it carried.

## Acceptance Criteria

- [ ] Given a story verified green in its own worktree, when the chain is
      landed with `worktree land` (or `autoland`), then after the worktree is
      gone `ai-flow status` in the primary shows the story from that proof,
      not `written; no verify captured`.
- [ ] Given `worktree remove --force` on a worktree holding evidence, when it
      runs, then the evidence is in the primary before the directory is
      deleted.
- [ ] Given the same journal line in both checkouts, when they are merged by
      the carry, then it appears once.
- [ ] Given a project that tracks `.coding-flow/`, when `init` or `upgrade`
      runs, then `.gitattributes` holds `merge=union` for
      `.coding-flow/*.jsonl` exactly once.
- [ ] Given a carry that cannot write (disk, permissions), when land runs,
      then land stops before deleting the worktree and says why.

## Edge Cases

- The primary is dirty with another session's work: the carry writes only
  under `.coding-flow/`, and only new files or appended lines; it never
  touches tracked files outside it.
- A worktree from an older CLI without a journal: only `runs/` is carried.
- Same-name evidence with different content: renamed `-from-<worktree>`,
  reported, never overwritten.

## Out of Scope

- Making `runs/` tracked in projects that ignore it (a project choice).
- Re-verifying after land (already done by `land`).

## Security

- Who: whoever runs `land`/`remove`, already able to delete the worktree.
- Hostile input: a worktree's evidence file names are matched against the
  evidence name pattern; anything else (path separators, `..`) is refused.
- Leak: nothing leaves the repository.
