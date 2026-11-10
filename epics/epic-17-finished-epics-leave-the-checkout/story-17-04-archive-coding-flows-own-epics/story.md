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
