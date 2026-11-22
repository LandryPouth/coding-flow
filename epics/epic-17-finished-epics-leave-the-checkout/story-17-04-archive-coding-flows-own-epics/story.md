# Story 17-04 — coding-flow archives its own finished epics

## Status: planned

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

- [ ] Given every epic the gate admits on the day it runs, when each is
      archived, then `epics/` holds only the epics still open plus
      `INDEX.md`. The file and byte counts before and after are recorded
      here.
- [ ] Given `ai-flow status`, `doctor`, `next` and `npm test` after the
      archive, then all four run clean, apart from warnings that existed
      before (recorded here).
- [ ] Given one archived epic picked at random, when its recovery line runs
      in a scratch clone, then the directory comes back intact.
- [ ] Given the "still links here" lists, then each is recorded here, and
      `docs/DOGFOODING.md` gets a row for any link that confuses a reader.
- [ ] Given `ai-flow status --json`, then `nextEpicNumber` is above every
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
