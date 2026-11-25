# Story 31-04 — A finished story leaves the checkout

## Why

`ai-flow archive` (epic 17) removes a whole epic only once every story is
finished and merged. Epics are long-lived: on 2026-11-25 this repository had
14 finished stories (~190 KB of story files) inside epics that still hold
open stories (19: 4/11, 26: 5/9, 29: …). Agents grep and read through them on
every run. The maintainer asked on 2026-11-25 that archiving reach done
stories, not only finished epics.

## Design

The epic stays; its finished stories leave, under the same gate and the same
record as an epic archive:

- **Gate, per story:** state done, verified or stale; no linked worktree;
  the story directory identical on the default branch.
- **What happens:** the story directory is `git rm`-ed (staged, not committed,
  as for an epic); the epic's `index.md` keeps the numbered line, rewritten as
  archived with a link to its `epics/INDEX.md` entry, so numbering and the
  dependency tree still read; `epics/INDEX.md` records, under the epic, each
  archived story's proof state as it stood (never upgraded), the default
  branch's commit and the `git checkout <sha> -- <dir>` that brings it back.
- **Numbers stay reserved:** duplicate-numbering checks and the next story
  number read archived stories from `epics/INDEX.md`.
- **The epic's later archive absorbs** its archived stories' entries.

## Acceptance Criteria

- [ ] Given an epic with 2 finished-and-merged stories and 1 planned one, when
      `ai-flow archive --stories <epic>` runs, then the 2 story directories are
      staged for deletion, the planned one is untouched, the epic's `index.md`
      lists the 2 as archived with a link, and `epics/INDEX.md` holds their
      proof state, commit and restore command.
- [ ] Given a finished story with a linked worktree, or whose directory differs
      from the default branch, then it is refused with the reason and the
      others still proceed.
- [ ] Given `--dry-run`, then nothing is written or staged, and the plan is
      printed.
- [ ] Given archived stories, then `status` shows them as an "archived (N)"
      count on their epic, `doctor` reports no broken story link and no
      duplicate numbering, and a new story of that epic does not reuse an
      archived number.
- [ ] Given the restore command from `epics/INDEX.md`, when run, then the
      story's files come back byte-identical.
- [ ] Given the epic later finished, when `ai-flow archive <epic>` runs, then
      its index entry includes the stories archived earlier, once.
- [ ] **Dependents (maintainer, 2026-11-25: "les stories qui dépendent d'une
      autre déjà sortie").** Given an epic whose dependency tree has `s2` and
      `s3` hanging off `s1`, with `s1` archived and `s2`, `s3` planned, then
      `status`, `next`, `worktree plan` and the autoland chain treat `s1` as
      finished (never missing, never blocking), `doctor` reports no broken link
      or tree edge, and `worktree add --story s2` works.
- [ ] Given an archived story, when `ai-flow archive show <epic>/<NN>` (or the
      story id) runs, then it prints the story's files from the recorded commit
      without restoring them, so an agent building on it can read what it
      promised. `flow-run`'s skill says to use it when a story it builds on is
      archived.
- [ ] Given a story that is finished but still referenced by an open story
      in-flight in a worktree (the worktree's branch contains the dependency's
      files), then archiving it on the base does not break that worktree's
      verify or land (tested with a real worktree in a throwaway repo).
- [ ] `ai-flow archive --stories` with no epic does every live epic. The
      Result records the bytes removed from this repository's checkout.

## Out of Scope

- Archiving automatically. 26-04 (the epic closes itself) may call it later;
  the maintainer's epic-run guidance runs `archive --stories` at each wave end
  once the release reached main.

## Commands

```bash
npm test
```

## Status: in-progress

## Result
