# Story 17-01 — Archive one finished epic

## User Value

`ai-flow archive epics/epic-08-evidence-levels` takes a finished epic out of
the checkout. It stages its removal and writes one entry in `epics/INDEX.md`:
the epic, its stories, the proof state they had at that moment, the commit
where the text still exists, and the command that brings it back. Nothing is
lost, and nothing unfinished can be archived by mistake.

## Requirements

- `ai-flow archive <epic-dir | NN>`, with `--dry-run` and `--json`.
- **Refusals.** Exit non-zero, write nothing, and name every reason when:
  - a story is `planned`, `in-progress` or `blocked` (proof-derived status,
    as `ai-flow status` computes it);
  - a worktree is linked to one of its stories;
  - the epic directory has uncommitted or untracked changes;
  - the directory's tree at `HEAD` differs from the default branch, or is
    absent there (the branch comes from `defaultBranch`,
    `bin/lib/policy.js:29`). The message says to merge first.
- **Archiving.** When nothing refuses:
  1. Record the full SHA of `HEAD`, where the directory exists.
  2. Append an entry to the archived section of `epics/INDEX.md`, creating
     the file if it is missing. The entry holds:
     - the epic number, slug and title;
     - each story's number, title and status as computed at that moment
       (`done`, `verified`, `stale`), plus the `contradicted` note if
       `status` gives one;
     - the date;
     - the short SHA;
     - one recovery line: `git checkout <sha> -- epics/<dir>`.
  3. Run `git rm -r -q -- epics/<dir>`. The tool does not commit: the user
     commits.
- **Links.** List the tracked files outside `epics/<dir>` that contain the
  string `epics/<dir>`, as "still links here". Do not edit them.
- **Idempotence.** Archiving an epic that already has an entry and no longer
  exists on disk prints "already archived" and exits 0.
- **Evidence.** Leave `.coding-flow/runs/` alone. `status`, `next`, `audit`
  and `trace` must not report a story absent from disk because evidence
  still names it (checked, not assumed).
- `docs/design-decisions.md` gets an entry for the command and the freeze
  argument from the epic `index.md`.

## Acceptance Criteria

- [ ] Given a temp repository whose epic has every story `done` or `stale`, is
      clean, and is identical on `main`, when `ai-flow archive <epic>` runs,
      then the directory is staged for deletion, `epics/INDEX.md` holds one
      entry naming each story, its status, the HEAD SHA and the `git
      checkout` recovery line, and the exit code is 0.
- [ ] Given that recovery line, when it runs in the temp repository, then
      the epic directory comes back byte for byte.
- [ ] Given an epic with a `planned`, `in-progress` or `blocked` story, or a
      linked worktree, or a dirty file, or a tree that differs from `main`,
      when `archive` runs, then it exits non-zero, names each reason, and
      leaves the disk and the git index unchanged.
- [ ] Given `--dry-run`, then the planned entry and the deletion are
      printed, and nothing is written or staged.
- [ ] Given an epic already archived, when `archive` runs again, then it
      prints "already archived" and exits 0 without a second entry.
- [ ] Given a story whose only proof was `no verify captured`, when it is
      archived, then the entry records that state as it stands and never as
      `verified`.
- [ ] Given evidence in `.coding-flow/runs/` for an archived story, when
      `status`, `next`, `audit` and `trace` run, then none of them lists that
      story or fails on it.
- [ ] Given a tracked file outside the epic that links into it, then
      `archive` lists it under "still links here" and does not modify it.

## Edge Cases

- **A user-written `epics/INDEX.md`** without the tool's markers: append the
  archived section after it. Never rewrite what is already there.
- **An epic number given as `08`** when two directories carry `epic-08-`:
  refuse and list both. (Story 17-03 prevents this from happening again.)
- **No `git`, or not a repository**: refuse. Without history, the deletion
  could not be recovered.
- **Security**: paths come from `listEpics` and are validated to sit under
  `epics/`. A `../` in the argument is refused. `git` gets `--` before every
  path.

## Out Of Scope

- Committing, pushing, or opening a PR.
- A `restore` command.
- Archiving several epics in one call (story 17-04 runs the command once per
  epic).
