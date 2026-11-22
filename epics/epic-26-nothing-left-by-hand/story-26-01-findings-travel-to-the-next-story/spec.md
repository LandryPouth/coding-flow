# Story 26-01 — Findings travel to the next story

## User Value

A risk a reviewer raised and nobody fixed — a P2 resolved as `documented`,
an implementer's own doubt, a critic item — reaches the stories it concerns
instead of being re-typed by hand into the next brief, and every one is
answered or still open in the report.

## Requirements

- Run state `openRisks`: findings resolved `documented` or `rejected` with a
  condition, `### Doubts` items from an implementer's `## Result`, `Needs
  you` answers that carry a condition, critic items (20-07). Each with its
  origin (story, reviewer role), files and shared identifiers.
- The implementer and reviewer prompts of a later story get the open risks
  whose files or shared identifiers (24-02) meet the story's *Likely files*,
  plus a one-line count of the others.
- The implementer answers each handed risk in `## Result` under `### Handed
  risks`: `handled` (how), `not relevant` (why) or `still open`. The CLI
  closes `handled` risks only after the story's verify and review pass.
- `REPORT.md` lists every risk with status and the story that closed it.
- Events `risk.open`, `risk.handed`, `risk.closed`.

## Acceptance Criteria

- [ ] Given a P2 resolved `documented` on `s1` naming `a.ts`, when `s2`
      lists `a.ts` in its likely files, then `s2`'s implementer and reviewer
      prompts contain it.
- [ ] Given `s2`'s Result marking it `handled` and `s2` passing review, then
      the risk is closed by `s2` in the report.
- [ ] Given a risk no later story touches, then the report lists it open at
      the end of the epic.
- [ ] Given an implementer `### Doubts` item, then it becomes an open risk.

## Edge Cases

- A risk without files: handed to every later story as a count line only.
- A story marking a risk `handled` and then blocked: the risk stays open.

## Out of Scope

- Carrying risks across epics (the report and the vault, 21-02, keep them).

## Security

- Risk text is data from agents: quoted in prompts as data, never as
  instructions.
