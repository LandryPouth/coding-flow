# Story 22-08 — Plan

## Implementation Context

- **Execution mode**: STANDARD.
- **Depends on**: 18-01 (journal and events), 22-03 (ladder, categories,
  `propose`), 23-02 (`proposal check` classes; the `masks-symptom` label is
  added there if 23-02 has shipped, otherwise this story adds the class).
- **Likely files**: `bin/lib/friction.js` (new), `bin/lib/ladder.js`,
  `bin/lib/events.js`, `templates/.claude/skills/flow-run/SKILL.md`,
  `templates/.claude/skills/flow-review/SKILL.md`, `evals/cases/`,
  `test/friction.test.js` (new).
- **Search anchors**: `review.found`, `ladder`, `proposal check`.
- **Scout pre-step**: no.
- **Areas to avoid**: the front door (`ai-flow help` short list, README
  quick start).

## Technical Notes

- Draft ranking is a fixed order, not a score: `check` > `skill` >
  `convention`.
- `masks-symptom` detection is a short pattern list on the draft's change
  (an ignore-file entry, a warning disabled, a delete of the output) — a
  label for the human, never a refusal.

## Decisions

- **Origin (2026-11-22):** the maintainer asked what to take from "Améliorez
  votre IA de 1 % par jour" (Codeur Senior, 2026-10-09). Kept: correct the
  instructions, not the output; the human picks; one improvement, one commit.
  Refused: a rule added on every friction (always-loaded context costs and
  dilutes, epic 22 Why), and any gain claimed without a measure (epic 21).
- **Machinery command, no new skill**, to keep the front door small (golden
  path).
- **Three distinct stories, friction and findings together:** one rule of
  three, not two thresholds.
- **Author kind recorded** so 21 can tell human corrections (the autonomy
  metric) from agent self-reports.

## Test Plan

Throwaway repos with a fixture journal; frictions and findings across
fixture stories; `ladder` and `ladder propose` output read as files and
exit codes. The skill lines get eval cases.

## Acceptance Traceability

- 1–2 → `test/friction.test.js`
- 3–5 → `test/ladder.test.js`
- 6 → `test/proposal-check.test.js`

## Commands

```bash
npm test
```
