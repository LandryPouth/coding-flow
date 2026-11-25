# Story 34-01 — The to-do list reads at a glance

## Status: in-progress

## User Value

With 50 items waiting, the maintainer sees first the few that block a deploy,
then how many other tasks and how many unchecked criteria remain, and can set
aside an item that no longer makes sense, with a reason kept in the story.

## Implementation Context

- Files: `bin/lib/todo.js` (scan, `todoCommand`, `todoDoneCommand`), the
  `todo` branch of `bin/ai-flow.js` (~line 876), `next`'s We need you block,
  `test/human-todo.test.js`, README (`What to do next`), CHANGELOG.
- Kinds today: `before: deploy`, `before: later` (Human to-do items) and
  `deferred` (acceptance criteria deferred to a human).
- Execution mode STANDARD (writes a story file on `drop`). Scout: no.

## Acceptance Criteria

- [x] Given 7 `before: deploy`, 13 `before: later` and 31 `deferred` items, when
      `ai-flow todo` runs, then the first line counts each kind
      (`Waiting on you: 7 before deploy, 13 to do later, 31 to check by hand`),
      the 7 `before: deploy` items are printed in full, and the others are
      summarised in one line each per kind with the command to see them
      (`ai-flow todo --all`).
- [x] Given the same items, when `ai-flow todo --all` runs, then two sections
      are printed — "To do" (`before: *`, deploy first) and "To check by hand"
      (`deferred`) — each oldest epic first, every item with its id.
- [x] Given `--json`, when `ai-flow todo --json` runs, then each item carries
      its kind and the totals per kind; existing fields are unchanged.
- [x] Given an item id, when `ai-flow todo drop <id> --reason "obsolete since
      epic 30"` runs, then the item's line in its story file is ticked and
      marked set aside with the reason and the date (one documented shape), it
      no longer appears in `todo` or `next`, and `--dry-run` prints the change
      and writes nothing.
- [x] Given `todo drop` without `--reason`, or an unknown id, when it runs, then
      it exits non-zero with one line saying what is missing and writes nothing.
- [x] Given more than 5 items, when `ai-flow next` prints We need you, then it
      shows the `before: deploy` items and one summary line for the rest, not
      the whole list.

## Commands

```bash
npm test
```

## Result

Set-aside shape (one, for every droppable item): `todo drop` ticks the line and
writes the date and the reason right after the box —
`- [x] (set aside 2026-11-25: obsolete since epic 30) (before: later) Rotate the key`
for a `## Human to-do` or `todo.headings` item, and
`- [x] (set aside 2026-11-25: covered by e2e) Given …, then …` for a deferred
`[~]` criterion. Ticked, the line is closed for `todo`, `next`, `ship`/`land` and
26-07's scanner; `todo done` uses the same locked rewrite. `verify`'s criteria
reader (`criterionItems`, spec-drift.js) reads a set-aside criterion as
**deferred** (not ticked) and strips the marker, so setting aside is silent to
the drift check, like ticking. The reason is one line without `(` `)`.

Short lists (≤ 10 items) keep the per-epic listing under the new count line, so
26-02's and 26-07's `todo` tests hold unchanged. `--json` adds `group`
(`deploy`, `next-story`, `later`, `check`) and `totals` (only when something
waits: the empty payload stays `{ count: 0, epics: [] }`); a deferred criterion
also gains `file` and `line`. `next`: past 5 urgent lines, only `before: deploy`
items are listed — still capped at 5 (26-07's contract), the count line names
each group it hides: `N more before deploy`, `N before the next story`,
`N question(s)`, `N yours to do`, `N later` (review round 1).

bethl, `git clone --no-hardlinks` of a6f090b2, `ai-flow todo`, first 15 lines
(cut at 110 columns). Before (88 lines):

```text
Waiting on you: 53 item(s)

epic-03-openapi-contract
- [deferred] Given registration is tested, when register with avatar is performed, then avatar is uploaded —
- [deferred] Given property operations are tested, when create draft → update → publish is performed, then
- [deferred] Given property search is tested, when search published properties with filters is performed, then
- [deferred] Given media operations are tested, when add/remove media on a property is performed, then Cloudin
- [deferred] Given location operations are tested, when browse cities and districts is performed, then paginat
- [deferred] Given amenity operations are tested, when search amenities is performed, then results are returne
- [deferred] Given visit operations are tested, when create visit → confirm → cancel is performed, then it
- [deferred] Given chat is tested, when open chat → send message is performed, then socket methods still wor
- [deferred] Given favorites are tested, when toggle favorite is performed, then it works — not tested at ru
- [deferred] Given notifications are tested, when view → mark as read is performed, then it works — not te
- [deferred] Given reviews are tested, when view reviews → reply is performed, then it works — not tested 

```

After (15 lines in all):

```text
Waiting on you: 8 before deploy, 14 to do later, 31 to check by hand

Before deploy:
- [before: deploy] Si ce n'est pas déjà fait : trancher d'abord la décision ouverte (profils désactivés o
- [before: deploy] La migration `drop_visit_forfeit` supprime trois colonnes au démarrage de l'API (Render la
- [before: deploy] Rien à lancer à la main : au déploiement de l'API, Render applique la migration `2026112
- [before: deploy] 43-02 — Rien à lancer à la main : le passage tourne seul chaque nuit à 2 h (heure du s
- [before: deploy] 43-03 — Avant de fusionner dans `main`, lancer à la main, base Docker de dev en marche :
- [before: deploy] 43-03 — Rien à lancer à la main : au déploiement de l'API, Render applique la migratio
- [before: deploy] Après le déploiement de 46-01, retirer `CHAT_TRANSLATION_ENABLED` du service Render `beth
- [before: deploy] Après le déploiement, retirer `TRANSLATION_ENABLED` du service Render `bethl`. (story-46-

14 to do later — ai-flow todo --all
31 to check by hand — ai-flow todo --all
```

bethl's `next` block (clone refreshed for round 1: 7 deploy, 14 later, no
next-story item), lines cut at 110 columns:

```text
We need you (21)
  - (before: deploy) Si ce n'est pas déjà fait : trancher d'abord la décision ouverte (profils désactivés ou
  - (before: deploy) La migration `drop_visit_forfeit` supprime trois colonnes au démarrage de l'API (Render
  - (before: deploy) Rien à lancer à la main : au déploiement de l'API, Render applique la migration `2026112
  - (before: deploy) 43-02 — Rien à lancer à la main : le passage tourne seul chaque nuit à 2 h (heure du se
  - (before: deploy) 43-03 — Rien à lancer à la main : au déploiement de l'API, Render applique la migration
  + 2 more before deploy, 14 later — ai-flow todo
```

Round 1: the count line names its groups. Three new tests (1 deploy + 6
next-story → `+ 6 before the next story`; bethl-like 7 deploy + 14 later →
`+ 2 more before deploy, 14 later`; questions and `Owner: human` stories →
`2 questions, 1 yours to do`) fail on HEAD (`git archive`) and pass here. Two
expected strings moved with the format, none dropped: 26-07's `+ 3 more, 1 later`
is now `+ 3 more before deploy, 1 later`, 34-01 criterion 6's `+ 4 more, 1 later`
is now `+ 4 before the next story, 1 later`.

Tests: `test/human-todo.test.js` gains six 34-01 tests (one per criterion);
all six fail on the base tree (`git archive HEAD`) and pass here.

## Review findings

### Round 1 — PASS (the maintainer's real pile, and the write) — two P2s to fix before landing

- [x] P2 bin/lib/next.js:277 — past 5 urgent items `next` lists only `before: deploy` items; `next-story` items and `## Needs you` questions fall into a bare "+ N more" (26-07 listed them) — fix: name the groups in the count line, e.g. "+ 6 before the next story, 14 later — ai-flow todo".
- [x] P2 bin/lib/next.js:277 — on bethl "+ 2 more, 14 later" does not say the 2 are deploy items — fix: "+ 2 more before deploy".

Held: bethl `todo` counts line + all 7 deploy items + 2 summary lines; `--all` two sections; ≤10 still opens with counts; `--json` 52 items, 0 existing fields changed; `drop` one line in the documented shape, dry-run writes nothing, CRLF/final newline kept, wrapped criterion first line only, fences ignored, `$&`/`$1`/backslashes literal, duplicate id refused with both locations, bad reason/unknown id exit 1; `criterionItems` counts set-aside as deferred; `todo done` works; mutations caught; no existing test changed.
