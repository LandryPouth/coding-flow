# Epic 34 — What waits for you reads at a glance

## Goal

When everything piles up, the maintainer still sees in one screen what only
they can do, and `ai-flow next` answers in seconds on a large repository.

Evidence (bethl, 2026-11-25): `ai-flow todo` printed 50 items in one block
grouped by epic — 7 `before: deploy`, 13 `before: later`, 31 `deferred`
acceptance criteria — so the 7 that block a deploy were buried; no item can be
set aside, only ticked done; and `ai-flow next` had not answered after 110 s
(about 190 stories; the per-story status model, already measured at ~80 s in
31-04's dry runs).

Asked by the maintainer on 2026-11-25 ("fais ce que tu proposes, et rend next
rapide dans bethl"). Follow-up of epic 26, which was at its story cap.

## Scope

- In: `ai-flow todo` output shape and a way to set an item aside with a reason;
  `next`'s We need you block follows the same summary; `next` (and the status
  model it reads) fast on a large repository.
- Out: new to-do sources, notifications, a UI; changing what counts as a to-do.

Backbone: a to-do is written → it piles up → the maintainer reads the summary →
does or sets aside each one → `next` answers at once.

## Stories

1. [story-34-01-the-to-do-list-reads-at-a-glance](story-34-01-the-to-do-list-reads-at-a-glance/story.md) *(STANDARD — output shape + `todo drop`, writes a story file)*
2. [story-34-02-next-answers-in-seconds](story-34-02-next-answers-in-seconds/story.md) *(STANDARD — performance, measured on bethl)*

The two stories touch disjoint files (todo.js and its rendering vs the status
model and identity reads) and run in parallel.

## Readiness

ready — no open question would change implementation.
