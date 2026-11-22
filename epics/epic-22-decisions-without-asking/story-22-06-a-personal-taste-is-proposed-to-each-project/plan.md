# Story 22-06 — Plan

## Implementation Context

- **Execution mode**: STANDARD — reads outside the repo (vault, read only),
  writes only proposal and conventions files inside it.
- **Depends on**: 21-02 (vault path and layout), 22-04 (provenance helpers,
  conventions append).
- **Likely files**: `bin/lib/preferences.js` (new: parse, filter, propose,
  accept, diff), `bin/lib/vault.js` (read helper, `preferences/` path),
  `bin/lib/bootstrap.js` (stack tags), `bin/ai-flow.js` (subcommand under
  `help --all`), `test/preferences.test.js` (new).
- **Search anchors**: `conventions.md`, `bootstrap --scan`, `vault.write`,
  `proposals/`.
- **Scout pre-step**: no.
- **Areas to avoid**: the guard; `RULES.md` templates (the profile is not a
  new rulebook); the front door (no new skill).

## Technical Notes

- Rule line format in a vault note:
  `- [eng-deep-modules] Prefer deep modules with a small API over many tiny
  functions. — why: … — tags: all — status: accepted`. Parse with one regex;
  anything else is prose for the human.
- Declined ids per project live in `.coding-flow/preferences.json`
  (`{ declined: [{ id, date }] }`), committed — the team sees what the
  project refused.

## Decisions

- **Proposals, never imports**: a personal rule enters a project only by a
  human tick; bulk copy would turn one person's habits into a team rule
  without review.
- **Project wins**: a declined or rewritten rule is a valid project choice,
  listed by `diff`, not a drift to correct.
- **Stack filter by tags, not by guessing**: a rule without a matching tag
  is proposed only when tagged `all`.

## Test Plan

Fixture vault in a temp dir; propose/accept/diff table tests; no-vault path;
manual pass on bethl with the real vault.

## Acceptance Traceability

- 1 → `test/preferences.test.js::propose filters by status and stack`
- 2 → `test/preferences.test.js::accept copies ticked and records declined`
- 3 → `test/preferences.test.js::diff shows conflicts read-only`
- 4 → `test/preferences.test.js::absent vault`
- 5 → observed YYYY-MM-DD in `## Result`

## Commands

```bash
npm test
```
