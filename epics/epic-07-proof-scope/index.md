# Epic 07 — Proof scope: a story is measured on its own diff

## Goal

Coverage, risk, test-weakening and deleted-test signals for a story are
computed on **what that story changed** — from the branch it forked from — and
the evidence says which base and which scope it used.

## Why

Measured on bethl (`docs/plans/hardening-roadmap.md`): every diff-based
signal uses `defaultBranch(root)` (`origin/HEAD` or `"main"`) as its base, in
five places of `bin/lib/harness.js`:

| Function | Line (approx.) | Feeds |
|---|---|---|
| `addedLinesByFile` | 670–700 | structural risk signals |
| `changedFilesForCoverage` | 1620 | coverage gate, `scoreDiffRisk` (also via `status.js:110`) |
| `changedLinesForCoverage` | 1705 | line-level patch coverage |
| `deletedFilesInDiff` | 1932 | deleted-test detection |
| `scanTestWeakening` | 1960 | weakened-test detection |

bethl's stories fork from `feature/EPIC-32-geo`. The last verify of story
32-03 counted **508 changed files and 82 test files**; replaying the
merge-base against `main` gives 505 files over 76 commits, 117 of which are
`.coding-flow/runs/*.json`. Consequences, all visible in the runs:

- any test touched anywhere in the epic satisfies the coverage gate of every
  story (`"75 test file(s) strengthened alongside 231 behavior file(s)"`);
- 71 of 86 evidence files score `high` from migrations and auth files of
  *other* stories — a risk score that is always high carries no information;
- the "3 test files deleted, 13 assertions removed" warning on 32-03 may
  belong to another story: nobody can tell from the evidence.

The external audit worried about risk being *under*-estimated; the runs show
the scope bug drowns the signal first.

## Scope

**In scope**

- One `resolveDiffBase(root, { story })` used by all five call sites (and
  `worktree-plan.js:278`'s diff risk), with an explicit order of sources.
- `worktree add --from <ref>` records the fork point; `place`/`lock` paths
  that create worktrees pass it.
- `.coding-flow/**` and configured generated paths never count as changed
  files for coverage, risk or weakening.
- Evidence records `diffBase: { ref, mergeBase, source, scope }` and the
  scope is printed by `verify`, `status`, `ship`.

**Out of scope — decisions made while planning**

- **Attributing commits to stories on a shared epic branch.** When verify runs
  on the epic branch itself (several stories committed there), the honest
  scope is "epic"; the evidence says so instead of pretending to be
  story-level. Per-commit attribution (trailers, story ids in messages) is a
  bigger contract change and is not needed once stories run in worktrees.
- **Changing what `ship` uses as PR base.** `ship.js` already has its own
  `--base`; this epic only reuses the same resolution where it is cheap.

## Backbone

`Backbone: a story worktree is created from the epic branch → the fork point is recorded → verify resolves the base from it → changed files exclude .coding-flow and generated paths → coverage, risk and weakening are computed on that set → the evidence and the CLI say "scope: story, base: feature/EPIC-32-geo"`

### Story dependency tree

```text
s1
├── s2
└── s3
```

## Stories

1. **story-07-01-resolve-the-story-diff-base** — `resolveDiffBase`, fork-point
   recording, all call sites switched, evidence `diffBase`. *(STRICT —
   changes every coverage and risk verdict)*
2. **story-07-02-ignore-evidence-and-generated-files** — `.coding-flow/**`
   always excluded; `harness.json` `ignoredPaths` (generated clients,
   `openapi.json`) excluded from coverage/risk/weakening. *(STANDARD)*
3. **story-07-03-show-the-scope** — `verify`, `status`, `ship` print the base
   and scope; `doctor` suggests `git remote set-head origin -a` when
   `origin/HEAD` is missing. *(QUICK)*

## Decisions

- **Order of sources** (first that yields a merge-base wins):
  1. `--base <ref>` flag on `verify`/`harness check`;
  2. `config.json` `baseBranch` (explicit, per project);
  3. the fork point recorded for the current branch
     (`git config branch.<name>.codingFlowBase`), written by `worktree add`;
  4. the **nearest** of the candidate refs — the current epic's branch if one
     matches the story's epic (`epic-NN` / `EPIC-NN` in the branch name),
     `develop`, the default branch — nearest = fewest commits in
     `merge-base..HEAD`;
  5. today's default branch.
  The source is recorded so a surprising scope can be explained.
- **git config, not a JSON file, for the fork point**: it travels with the
  branch in the repository's own config, survives worktree removal, needs no
  locking, and is invisible to the tree token.
