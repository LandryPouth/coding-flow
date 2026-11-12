# Story 17-03 — An epic number is never handed out twice

## User Value

`/flow-plan` takes the next epic number from everything the checkout can see:
the directories on disk, the archived entries, and the other local and
fetched branches. `doctor` flags a collision as soon as one exists. "Story
08-02" keeps naming one thing in commits, in DOGFOODING rows and in evidence,
even after epic 08 is archived.

## Requirements

- **`nextEpicNumber`** is the highest number found plus one, across:
  - the `epic-NN-` directories in the working tree;
  - the `<!-- coding-flow:archived NN slug -->` entries in `epics/INDEX.md`;
  - the `epic-NN-` directories under `epics/` on every local branch and
    remote-tracking ref (`git for-each-ref`, then `git ls-tree --name-only
    <ref> -- epics/`), with no fetch and no network.

  Numbers are zero-padded to the width already in use (`16`, not `016`).
- **It is exposed** in `ai-flow status --json` as `nextEpicNumber`, together
  with `nextEpicNumberSources`: which refs were scanned, and whether the
  remote refs are as of the last fetch. `ai-flow archive --refresh` prints
  it.
- **Doctor**, next to the existing `duplicate_epic_number` check:
  - `archived_epic_number_reused`: a directory on disk carries a number that
    an archived entry already holds, under a different slug;
  - `epic_number_on_other_branch`: a directory on disk carries a number that
    another ref uses under a different slug, and that the current branch
    does not have. The message names the ref and says to renumber before
    merging.
- **`/flow-plan`**: the Conventions line on numbering tells the planner to
  take the epic number from `ai-flow status --json` → `nextEpicNumber`, not
  from a directory listing. Then update `evals/cases/flow-plan.json` and run
  `plugin sync`.

## Acceptance Criteria

- [ ] Given a temp repository with `epic-01`, an archived entry for
      `epic-02` and a branch `other` carrying `epic-03-x`, when `ai-flow
      status --json` runs on `main`, then `nextEpicNumber` is `04` and
      `nextEpicNumberSources` lists `other`.
- [ ] Given a new `epic-02-y` on disk while `epic-02` is archived under
      another slug, when `doctor` runs, then it warns
      `archived_epic_number_reused` and names both slugs.
- [ ] Given `epic-03-z` on the current branch while `other` carries
      `epic-03-x`, when `doctor` runs, then it warns
      `epic_number_on_other_branch` and names `other`.
- [ ] Given the same slug on both branches (the same epic, not yet merged),
      when `doctor` runs, then it does not warn.
- [ ] Given a repository with no remote and no other branch, then
      `nextEpicNumber` comes from the disk and the index alone, and nothing
      fails.
- [ ] Given `flow-plan/SKILL.md`, then the numbering convention names
      `nextEpicNumber`, and the skill evals pass.

## Edge Cases

- **Many refs.** One `ls-tree` per ref is cheap, but cap the scan (for
  example at 200 refs) and say so in `nextEpicNumberSources` when the cap
  is hit.
- **Story numbers inside an epic**: unchanged. They follow the epic number,
  and the existing `duplicate_story_number` check already covers them.
- **Two clones that have not fetched each other**: still caught only after
  the merge, by the existing `duplicate_epic_number`. Say so in the doctor
  comment; do not claim more.
- **Security**: ref names come from `git for-each-ref` and are passed as
  argument-array entries, never interpolated into a shell string.

## Out Of Scope

- A shared counter, or any network call.
- Renumbering automatically.
