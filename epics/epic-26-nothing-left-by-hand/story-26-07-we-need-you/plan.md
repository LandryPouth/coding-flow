# Story 26-07 — Plan

## Implementation Context

- **Execution mode**: STANDARD — reads story files, edits one checkbox, adds a
  PR body section; no new trust boundary.
- **Likely files**: `bin/lib/todo.js` (26-02's reader: add `## Human to-do`,
  `when`, ids, `done`), `bin/lib/next.js` (We need you block, `--json`),
  `bin/lib/status.js` (header line), `bin/lib/ship.js` (PR body section),
  `bin/lib/worktree.js` (land/autoland print), `bin/lib/verify` path and
  `bin/lib/doctor.js` (`todo.uncaptured`, `when` and secret checks),
  `bin/lib/guard.js` (reuse secret patterns), `bin/ai-flow.js` (`todo done`),
  skills `flow-plan`, `flow-run`, `flow-review`, `flow-next` and their
  `templates/.claude/skills/` copies, `docs/rules-and-limits.md`.
  Tests: `test/todo.test.js`, `test/next.test.js`, `test/ship.test.js`,
  `test/doctor.test.js`.
- **Shared identifiers**: `## Human to-do`, `(before: deploy|next-story|later)`,
  `todo.uncapturedPatterns`, `todo.uncaptured`, `needsYou`, `We need you`.
- **Search anchors**: `buildQueue`, `Nothing waiting on you`, `TIER_LABELS`,
  `prBody`, `Needs you`, `Owner:`, `withFileLock`, secret patterns in `guard.js`.
- **Scout pre-step**: no.
- **Areas to avoid**: the tier order of `next` (unchanged); 24-06 routing;
  blocking ship or land.

## Decisions

- **A block above the queue, not a tier.** A human to-do has no command to
  run, and the tiers rank commands. Folding to-dos into tier 1 would hide the
  next command behind something the tool cannot do; printing them first, apart,
  keeps both visible. (Maintainer, 2026-11-14: "`next` should have a section
  that says we need you".)
- **`when` instead of priority.** The only question that matters for a fast
  maintainer is "before what?": deploy, the next story, or nothing. It also
  decides where the item is repeated (ship and land for `deploy`).
- **Warn, never block.** Ship, land and verify keep their meaning; to-dos are
  said where the work leaves the machine. Blocking would push agents to tick
  boxes they cannot check.
- **Capture is the hard part.** 26-02 reads headings; bethl shows the dangerous
  items were never under one. Hence the skills write them at once, and the
  uncaptured-prose warning catches the rest — mechanical, phrase list in
  config, no LLM.
- **Every epic of the checkout, landed included**, for `next`'s block only:
  `before: deploy` items outlive the land by design.

## Test Plan

Fixture project with: a story `## Human to-do` of each `when`; an epic index
with a heading from `todo.headings`; a landed epic with an open `deploy` item;
a `## Needs you` story; an `Owner: human` ready story; a `## Result` with
"avant le déploiement" and no item; a to-do with a secret-looking value.
Assert `next` text and `--json`, `todo done` diff (one line), `ship` PR body
(dry-run), verify warning, doctor error and masking.

## Acceptance Traceability

- 1–4 → `test/next.test.js::we need you`
- 5 → `test/todo.test.js::done`
- 6 → `test/doctor.test.js::todo.uncaptured`, `test/verify.test.js::todo warning`
- 7 → `test/ship.test.js::before you deploy`
- 8 → `test/doctor.test.js::todo secret`
- 9 → `test/next.test.js::json needsYou`

## Commands

```bash
npm test
```
