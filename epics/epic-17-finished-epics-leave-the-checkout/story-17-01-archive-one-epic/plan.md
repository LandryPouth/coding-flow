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
- **`epics/INDEX.md` is staged with the deletion when it was clean** (or
  new), so one commit carries both; when it holds the user's own
  uncommitted edits it is written but left unstaged, and the output says so
  (staging it would sweep their edits into the archive commit). *(Decided by
  the unattended run, 2026-11-14.)*
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
