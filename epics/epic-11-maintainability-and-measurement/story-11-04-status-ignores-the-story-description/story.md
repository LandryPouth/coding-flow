# Story 11-04 — `status` does not read a story's own description as progress

A single-file `story.md` written by `/flow-plan` (QUICK) opens with a prose
paragraph. With no `## Status` and no `## Result`, `resultNotes`
(`bin/lib/storage/local.js` ~20) keeps every non-heading, non-unchecked line;
more than 160 characters → `in-progress`. Seen 2026-10-16 on the six new
single-file stories of epics 05–11 (worked around with `## Status: planned`).

*(QUICK — one function and its test.)*

## Acceptance Criteria

- [ ] Given a `story.md` with a title, a prose paragraph, a mode line in
      parentheses and an unchecked acceptance-criteria list, no `## Status`,
      no `## Result`, then `inferStoryStatus` returns `planned`.
- [ ] Given the same file with a `## Result` section holding > 160 characters,
      then `in-progress` (unchanged).
- [ ] Given a split story (`tasks.md`) with prose notes outside `## Result`,
      behaviour is unchanged (only text before the first `##` heading is
      ignored, and only for single-file stories).
- [ ] Remove the `## Status: planned` workaround lines from the epics 05–11
      single-file stories that are still planned, and check `ai-flow status`.
- [ ] `npm test` green; DOGFOODING row of 2026-10-16 (status) resolved.

## Status: planned
