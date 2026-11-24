# Story 17-04 — coding-flow archives its own finished epics

## Status: in-progress

The proof that 17-01 to 17-03 work is coding-flow using them on its own
`epics/`. On 2026-11-10 the gate would have admitted 13 of 15 epics, all but
13 (a `blocked` story) and 15 (in progress). Run it, measure it, and log
whatever breaks.

*(QUICK: no code unless something breaks. Anything that breaks becomes a
DOGFOODING row and, if needed, a fix story.)*

**Implementation Context**:

- Run `ai-flow archive --dry-run` per epic first, then for real, one epic per
  commit, so each one can be reverted alone.
- Before the commit, check that the CI and the tests do not read an archived
  epic as a fixture (`grep -rn "epics/epic-" test/ scripts/ evals/`).

## Acceptance Criteria

- [x] Given every epic the gate admits on the day it runs, when each is
      archived, then `epics/` holds only the epics still open plus
      `INDEX.md`. The file and byte counts before and after are recorded
      here.
- [x] Given `ai-flow status`, `doctor`, `next` and `npm test` after the
      archive, then all four run clean, apart from warnings that existed
      before (recorded here).
- [x] Given one archived epic picked at random, when its recovery line runs
      in a scratch clone, then the directory comes back intact.
- [x] Given the "still links here" lists, then each is recorded here, and
      `docs/DOGFOODING.md` gets a row for any link that confuses a reader.
- [x] Given `ai-flow status --json`, then `nextEpicNumber` is above every
      archived number.

## Commands

```bash
npm test
```

## Result

### Baseline (2026-11-22, before any archive)

- `epics/`: 30 epics, 436 files, 1,144,130 bytes; no `INDEX.md` yet.
- Fixtures: `grep -rn "epics/epic-" test/ scripts/ evals/` names real epic
  directories (`epic-08-evidence-levels`, `epic-09-monorepo`) only as paths
  inside throwaway directories (`test/archive.test.js`,
  `test/epic-index.test.js`); no test, script or eval reads the repository's
  own `epics/`.
- `doctor` warnings before: the global OpenCode install is behind; no
  `v0.15.0` tag; six story entries of epic 13's index are not links;
  `epics/` has no `INDEX.md`.
- `status --json`: `nextEpicNumber` 31.

### First attempt — every epic refused by the gate

`ai-flow archive NN --dry-run` for 01 to 16: every epic "differs from main:
merge it into main first". `main` was still at 0.14.0 (release PR #59 open),
so nothing was archived — the gate holds. Re-run once PR #59 is merged and the
local `main` ref is updated (`git fetch origin main:main`).

The dry-run also showed 16-03 (and `status` showed 17-03) as `in-progress`:
both wrote `## Status: done` in `spec.md`, but a three-file story's status is
read from `tasks.md`. Fixed in `8e43db3`. Twenty older stories keep the line in
`spec.md` only, so their written status is not read either; they pass the gate
on their proof state.

### Run (2026-11-24, `main` at `2592244`, 0.15.0)

**Gate.** `archive NN --dry-run` admitted every epic from 01 to 16. Epic 17
(this story) and epics 18 to 30 (planned or open; worktrees open for 19-05
and 29-03) were not tried. The only epic files that still differed from
`main` were in epic 19 (the 19-08 docs), which was not a candidate.

**Archived**, one commit each, each revertible on its own:

| Epic | Files | Commit |
| --- | --- | --- |
| 01 | 16 | `e638338` |
| 02 | 11 | `9b77f2a` |
| 03 | 8 | `75f5c40` |
| 04 | 11 | `8bd796d` |
| 05 | 14 | `f613646` |
| 06 | 8 | `1d3b526` |
| 07 | 8 | `0e25fcf` |
| 08 | 13 | `e2ff10d` |
| 09 | 8 | `e1dc446` |
| 10 | 12 | `8969df3` |
| 11 | 9 | `0898a51` |
| 12 | 9 | `9a41257` |
| 13 | 29 | `e6816b2` |
| 14 | 20 | `519dcc9` |
| 15 | 14 | `43a5844` |
| 16 | 9 | `b8dde36` |

**Counts.**
- Before: 30 epics, 436 files, 1,144,130 bytes.
- After: 14 epics (17 to 30) plus `INDEX.md`, 247 files, 479,427 bytes.
- That is 189 fewer files (−43 %) and 58 % fewer bytes.

**After the archive.**
- `doctor`: two warnings, both present before. The global OpenCode install is
  behind, and there is no `v0.15.0` tag. Two baseline warnings are gone: the
  six unlinked entries in epic 13's index, and the missing `INDEX.md`.
- `next`: no error. It names a stale proof (`17-01`), the same kind of answer
  as before.
- `status`: runs, with 80 stories listed.
- `npm test`: 1765 tests, 1765 pass, 0 fail.

**Recovery.** Epic 16 was picked with `shuf`. In a scratch clone of `develop`,
its `INDEX.md` line `git checkout 2592244… -- epics/epic-16-…` brought back
9 files. The tree hash, `b6e2561`, is identical to the one at `2592244`.

**`nextEpicNumber`.** 31: 14 directories, 16 archived entries. That is above
every archived number.

**"Still links here".**

| Epic | Files reported |
| --- | --- |
| 01 | `docs/design-decisions.md`, `docs/plans/multi-agent-install.md` |
| 02 | `epics/INDEX.md`, 03-01 `plan.md` and `tasks.md` |
| 03 | `docs/DOGFOODING.md`, `epics/INDEX.md`, `epic-04/index.md` |
| 04, 05, 06, 07, 09 | `docs/DOGFOODING.md`, `epics/INDEX.md` |
| 08 | `epics/INDEX.md`, 17-01 `spec.md`, `test/archive.test.js`, `test/epic-index.test.js` |
| 10 | `README.md`, `epics/INDEX.md` |
| 11, 13, 14, 15, 16 | `epics/INDEX.md` |
| 12 | `README.md`, `docs/design-decisions.md`, `epics/INDEX.md` |

Most of these lists are noise. `INDEX.md` is reported because its own Recover
line names the path. The two tests are reported because they use
`epic-08-evidence-levels` as a fixture name inside throwaway directories. The
real dead links are in `README.md`, `docs/design-decisions.md` and
`docs/DOGFOODING.md`. Both points are logged as one DOGFOODING row (below);
the links were left as they are.

### Follow-up: references repointed, and the list sorted out (2026-11-24)

**References.** 19 references to an archived epic now point to that epic's
entry in `epics/INDEX.md`. Their text is kept and none was deleted.
- 2 were Markdown links that dangled: `README.md` (epic 12) and
  `docs/design-decisions.md` (epic 12). Their target is now the INDEX anchor.
- 17 were plain path references a reader would follow. Each keeps its path
  and gains an "archived" link to the INDEX entry:
  - `README.md`: epic 10.
  - `docs/design-decisions.md`: epic 01.
  - `docs/plans/multi-agent-install.md`: epic 01, twice.
  - `docs/DOGFOODING.md`: epics 04, 05, 06, 07 and 09.
  - `docs/plans/hardening-roadmap.md`: epics 05 to 12, one row each.

Some references were left as they are: commands quoted in old DOGFOODING
rows, the example `epic-03-kyc` in `README.md`, and the fixture names in
epic 17's own stories. They record what was run, or they are examples, so
they point at nothing.

**The list.** The archive command's list is now in two parts.
- "Still links here" lists only Markdown files with a link into the epic.
- "Also named in" lists the files that only mention it.
- `epics/INDEX.md` is no longer listed.
- Test: `only Markdown links into the epic are "still links here"; the index
  and plain mentions are not` in `test/archive.test.js`. It was red before
  the change and is green after.


### Review fixes (2026-11-24)

- **INDEX anchors.** The entry marker used to sit on the heading line, where
  it could end up in GitHub's anchor, so the 19 repointed links could miss
  their entry. The marker now sits on its own line above the heading, so the
  anchor is the plain heading slug. This keeps the 17-02 contract: the reader
  finds a marker anywhere in the archived section, and old-shape entries are
  still read. The 16 entries in this repository's `INDEX.md` were moved to
  the new shape. The links needed no change. All 19 anchors were checked
  against the slugs of the headings: 19 match, none missing.
- **Recovery needs the default branch.** The recovery commit `2592244` is a
  merge on `main`, not an ancestor of `develop`. The INDEX header, the README
  row and design decision 18 now say to fetch the default branch first.
- **The links that count.** `linksInto` now resolves each link target from
  the file it is in. It covers:
  - inline links, with a title or in angle brackets;
  - reference definitions;
  - HTML `href` and `src`;
  - percent-encoded paths;
  - root-relative paths;
  - relative links from a sibling epic.

  Fenced code blocks and code spans are skipped. Tests in
  `test/archive.test.js`: `the entry heading is plain text…` and `every
  Markdown link form into the epic is a link…`. Both were red before the
  change and are green after.
- **Doctor (P1).** `epics/INDEX.md` no longer matched the epics on disk: it
  listed 17-04 as planned, and 29-04 was missing. `ai-flow archive --refresh`
  now runs as the last step before the closing commit. `npm test` passes all
  1768 tests. Doctor's output, exit 0, as run:

  ```
  Warnings:
  - the OpenCode install for every project (/home/landry_pouth/.config/opencode) is behind this version (2 file(s) missing, e.g. skills/flow-recover/SKILL.md) — run `ai-flow upgrade --global`, then restart OpenCode
  - version 0.15.0 has no v0.15.0 tag — after `npm publish`, run `npm run release`
  ```

  Both warnings were in the baseline. Nothing else is reported.
