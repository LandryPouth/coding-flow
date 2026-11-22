# Story 15-06 — Did it work? Re-take the study's measures

## Status: done

The study ends with five measures "readable from `.coding-flow/runs/`".
Nothing re-takes them once the work lands; without this story, the study's
success is asserted, which is the failure the tool exists to reject.

*(QUICK — measurement and a write-up. Runs after every other story of epics
13–15 has landed.)*

## Acceptance Criteria

- [x] The run analysis (study, *Reproducing the measurements*) re-run on the
      runs recorded **since epic 13 started**: review passes per STRICT
      story (was 10–12, target ≤ 3); share of verifies at `verified` (was
      0 %); share of P1s caught by `verify` rather than review; surviving
      mutants per story (if 15-05 was built); new worktree rows in
      `docs/DOGFOODING.md`.
- [x] A dated *Re-measured* section in `docs/plans/uncle-bob-gauntlet.md`
      with the numbers, whatever they say, and which targets were missed.
- [x] The study's open question (make the worktree layer optional) gets an
      answer from the worktree-row count, recorded in
      `docs/design-decisions.md` if it is decided.
- [x] The analysis script is committed under `scripts/` so the next
      re-measure is one command.

## Result

- `scripts/remeasure-study.js --runs <dir> --since <date> [--json]`, with
  `test/remeasure-study.test.js` (a throwaway tree of runs, an epic index and
  a DOGFOODING log). Not in the package: a maintainer script.
- Run on the primary checkout's runs since 2026-10-18 (epic 13's start):
  29 / 105 verifies at `verified` (was 0 / 206); STRICT stories of epics
  13–15 at 1–2 review files, 15-05 at 4 stated passes, 14-03 with none
  recorded; 0 defects caught by a gate (5 gate reds: 3 size-ratchet stories,
  1 claim misuse — no baseline to compare); no mutation survivor recorded
  (the probe is not configured here); worktree rows 12 / 38 → 19 / 72 over
  the whole log, 8 / 34 by surface since the date, 7 open, plus 6 rows
  caused by one.
- The *Re-measured 2026-11-14* section of `docs/plans/uncle-bob-gauntlet.md`
  holds the table, the missed targets and what the numbers under-count
  (evidence removed with the worktree at land, so review files and gate reds
  are floors; 15-02 NOT PROVEN after land; flakes).
- Criterion 3: the count answers the open question (the friction persisted).
  The recommendation — make the worktree layer optional, and first carry
  evidence into the primary at land — is written in the study as a
  recommendation. It is a product decision, not taken here, so nothing is
  recorded in `docs/design-decisions.md`.

## Decisions

- **Since 2026-10-18**, the day epic 13 started (`git log` of its folder).
- **Review passes are printed two ways, never merged**: the review files
  recorded and the passes their accepted-risk text states. A re-record after
  land holds one file for several passes; an identical re-record (same story,
  verdict, counts and the same non-empty text) counts once. Two reviews
  without text are two reviews, whatever their counts.
- **Gate reds are classified, never compared with P1s**: a red verify whose
  commands passed is listed by the gate that failed, one count per story and
  gate. Whether it caught a defect is read from the run (a size ratchet, a
  misused `--base`), not computed; comparing red runs with review findings
  mixed two units (first review of this story). Reds on commands mix real
  reds and timing flakes and are counted apart.
- **Intensity is the plan's**, read from the epic index entry, else the
  story's own files: the runs do not record the mode a verify ran at.
- **A STRICT story with no review recorded is listed**, not omitted. The
  window is a date: re-verified stories of epics 01–12 appear there too; the
  write-up says so rather than filtering them.
