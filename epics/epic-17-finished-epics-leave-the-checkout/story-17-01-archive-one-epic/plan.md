# Story 17-01 — Plan

## Implementation Context

- **Execution mode**: STRICT. The command deletes tracked files, though only
  after the refusals pass and always in a way git can recover.
- **Likely files**:
  - `bin/lib/archive.js` (new);
  - `bin/ai-flow.js` (dispatch, next to `status` at line ~855);
  - `bin/lib/usage.js`: help, outside the daily front door;
  - `bin/lib/epic-index.js` (new): reads and writes `epics/INDEX.md`
    between markers, and is reused by 17-02 and 17-03;
  - `bin/lib/status.js`: the story status and the `contradicted` note,
    reused, not recomputed;
  - `bin/lib/storage/local.js`: `listEpics` and `storyTitle`;
  - `bin/lib/policy.js:29`: `defaultBranch`;
  - `test/archive.test.js` (new).
- **Search anchors**: `listEpics`, `contradicted`, `defaultBranch`,
  `checkDuplicateNumbering`, `latestVerifyByStoryDir`.
- **Scout pre-step**: yes. Check how `status`, `next`, `audit` and `trace`
  treat evidence whose story directory no longer exists (criterion 7). Fix
  only what is actually wrong.
- **Areas to avoid**: the guard, `verify`, and the evidence format.

## Technical Notes

- Tree equality: compare `git rev-parse HEAD:epics/<dir>` with
  `git rev-parse <default>:epics/<dir>`.
- Dirty check: `git status --porcelain -- epics/<dir>`.
- `git` is a shell-out with `execFileSync` and an argument array, never a
  shell string, as `ship.js` and `worktree.js` already do.
- The archived entry is plain markdown. The `<!-- coding-flow:archived NN
  slug -->` comment on its heading is what idempotence and story 17-03 read.

## Decisions

- **Stage, do not commit.** The user sees the deletion in `git status` and
  commits it with their own message. This is also how the command stays
  undoable before the commit (`git restore --staged --worktree`).
- **`epics/INDEX.md` is staged with the deletion** when it is absent,
  committed as is, or staged with nothing more in the work tree (a previous
  archive of the same uncommitted batch, as 17-04 will run). An untracked
  INDEX.md is written and left unstaged. A deleted copy (it would be
  recreated without its earlier entries), unstaged edits, or a symbolic link
  (the write would leave the repository) refuse; a rollback restores the
  previously staged blob. *(Re-review, 2026-11-14.)*
- **Ignored files refuse too.** `git status --porcelain --ignored`: `git rm`
  would leave them behind, so the directory would not leave the checkout.
- **The recovery line names the full SHA;** the entry shows the short one.
- **"Already archived" only when the directory is gone.** An epic brought
  back with its recovery line and archived again gets a second entry, at its
  new commit: that is a second archive, not a duplicate.
- **Scout result (criterion 7).** `status`, `next` and `trace` walk the
  epics on disk, so evidence of a removed story never reaches them.
  `audit --check` grouped the latest verify per story *from the run files*
  and failed on an archived story's old red or stale run (reproduced by the
  test before the fix); the review summary listed its accepted P1s by name.
  Both now skip a story directory under `epics/` that no longer exists
  (`storyStillOnDisk`, `bin/lib/audit.js`). The ledger itself keeps every
  entry: it is history.
- **Independent review (2026-11-14), fixed:**
  - only `done`, `verified` and `stale` pass the gate; any other written
    status (`todo`, `draft`, `wip`, …) refuses as "unrecognised status";
  - the recovery line names the default branch's commit, not `HEAD` (a
    squash merge and a deleted branch would lose a story-branch commit; the
    gate already guarantees the two trees are equal);
  - an ignored `epics/INDEX.md` refuses before anything is written; the
    write runs `git rm` → entry → `git add` and any failure puts all three
    back (tested with a read-only INDEX.md and a held `index.lock`);
  - `audit` skips only the evidence of a story whose epic has an archived
    entry and whose directory is gone; a story deleted by hand is still
    judged. `epic-index` became a core module for it (pure fs reader);
  - with only archived evidence left, `audit --check` keeps failing (no proof
    for anything on disk) but says so: "no verify runs recorded for a story
    still on disk (N run(s) belong to archived epics)";
  - the base is the remote default, then main, master, develop — the first
    that exists, locally or as last fetched;
  - `epic-8-x` and `epic-08-x` are the same epic; an unnumbered epic
    (`epic-misc`) is written with `-` as its number and is idempotent too;
  - a storage backend other than `local` refuses; a subdirectory that is not
    `story-*` refuses (the gate cannot read its state).
- **Review P2s accepted:** the gate reads the proof of the checkout it runs
  in (story 17-04 must run from the primary, after lands); a linked worktree
  is found by branch name, as `status` does; the link search covers tracked
  files under the project root only.
- **Out of scope, planned separately by the run:** the coverage gate read
  this story as `not-required` because the risk scored low — a `git rm` is
  not a structural signal in `risk.js`.
- **Design-decisions entry 18**, not 16: entry 16 is reserved by story
  16-01, which runs in parallel.
- **A forced archive is not in this story.** The gate already admits 13 of
  15 epics; add a `--force` only if story 17-04 finds a real case.

## Test Plan

Behavioural tests on throwaway repositories (`mktemp -d`, `git init`, a
`main` branch, fixture epics). Assert:

- the exit codes;
- `git diff --cached --name-status`;
- the content of `epics/INDEX.md`;
- the round trip of the recovery line;
- the untouched state after each refusal.

## Acceptance Traceability

- 1–2, 4–6, 8 → `test/archive.test.js`
- 3 → `test/archive.test.js` (one test per refusal)
- 7 → `test/archive.test.js` (status/next/audit/trace on a repository with
  orphan evidence)

## Commands

```bash
npm test
```
