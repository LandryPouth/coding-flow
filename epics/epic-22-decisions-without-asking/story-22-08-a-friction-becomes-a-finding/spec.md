# Story 22-08 — A friction becomes a finding

## User Value

When the human says "you did this wrong, and here is why" in the middle of a
session, that correction is recorded like a review finding instead of being
lost with the session. A friction seen once stays a note. Seen in three
distinct stories, it climbs the ladder (22-03), and the fix it proposes is the
most mechanical one that would have caught it: a test, a hook or a `doctor`
check before a skill line, and a skill line before an `AGENTS.md` rule.

## Requirements

- `ai-flow friction "<what went wrong>" --why "<why it was wrong>"
  [--story <dir>] [--category <slug>]` (machinery, never on the front door):
  appends a `friction.reported` event to the journal (18-01), with the
  story, the date, the author kind (`human` when typed by the user, `agent`
  otherwise) and a category slug (given, or proposed from the text and shown
  for the human to keep or change).
- The workflow skills (`/flow-run`, `/flow-review`) say, in one line, to run
  it when the user corrects the agent's process (not the product), and to ask
  "why" once if the reason is missing. No new user-facing skill.
- The ladder (22-03) counts friction events with review findings under the
  same category: three distinct stories, from either source, list it.
- `ladder propose` for a category that friction fed ranks its draft fixes by
  how mechanically they enforce the rule: `check` (test, hook, `doctor`, gate
  config) → `skill` (the skill whose step failed) → `convention` (one line
  in `docs/conventions.md` or `AGENTS.md`). Each draft names its site.
- A draft that only hides the symptom (ignores the file, silences the
  warning, deletes the output) is labelled `masks-symptom`, and
  `proposal check` (23-02) sends it to the maintainer.
- The proposal names the likely root cause when the frictions point to one:
  the agent working around a guard, a hook or a rule is the cause, not the
  stray file it left.

## Acceptance Criteria

- [ ] Given `ai-flow friction "left .msg files after commit" --why "the
      tree must be clean"`, then one `friction.reported` event exists with
      both texts, a category and the author kind, and no other file changed.
- [ ] Given `--why` missing, then the command refuses with exit 2 and says
      a friction needs its reason.
- [ ] Given the same category in two frictions and one review finding from
      three distinct stories, then `ladder` lists it with all three.
- [ ] Given two frictions in the same story, then they count as one story.
- [ ] Given `ladder propose` on that category, then the drafts are ordered
      `check`, `skill`, `convention`, and a draft that adds an ignore entry
      is labelled `masks-symptom`.
- [ ] Given a draft labelled `masks-symptom`, then `proposal check`
      classifies it `maintainer-question`.

## Edge Cases

- A correction of the product ("the button should be blue") is a story
  change, not a friction: the skill line says so; nothing enforces it.
- Free-text categories that differ by wording are not merged (as 22-03).
- No journal yet (18-01 not shipped in a project): the command refuses and
  names the missing journal; it never writes a side file.

## Out of Scope

- Applying any draft. Acceptance stays a human edit (22-03).
- Reading past session transcripts to find frictions.
- A session-end "retro" skill: the friction is recorded when it happens.
