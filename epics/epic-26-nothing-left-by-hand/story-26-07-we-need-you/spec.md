# Story 26-07 — We need you

## User Value

A maintainer who moves fast never loses an action only they can take: run a
backfill in production before the deploy, set an environment variable, create
an account, sign off the terms. Today these are born in the middle of a story
and end up in prose — a `## Result` paragraph, a chat report, agent memory —
where nothing reads them again. With this story they are written in one shape
the moment they appear, `ai-flow next` opens with them under **We need you**,
and shipping or landing the work they guard says them out loud.

Evidence (bethl, 2026-11-14): of three to-dos that would break production if
forgotten, one sat under a to-do heading 26-02 can read (`RELIABILITY_SINCE`),
one only in a `## Result` paragraph (37-07: "run the backfill **before** the
deploy — order is mandatory"), and one nowhere in the repository (40-06: "the
`drop_visit_forfeit` migration ships in the same window as the code" lived in
the orchestrator's chat report and the vault run note).

## Requirements

- **One shape.** A story file (`story.md`, `tasks.md` or `spec.md`) or an epic
  `index.md` may carry a `## Human to-do` section. Each item is one checkbox
  line:
  `- [ ] (before: deploy) Run scripts/backfill-agent-handles.ts in production, then deploy`
  - `when` is one of `deploy` (before this work reaches production),
    `next-story` (before the next story of the chain can run), `later`
    (no deadline). Missing → `later`, and doctor warns.
  - The id is derived (epic, story, normalized text), short and printed by
    `todo`/`next`; editing the text changes it, which is fine.
  - Never a secret value: the guard's secret patterns run on these lines; a
    match is a doctor error and the line is printed masked.
- **Written when it appears.** `flow-plan` writes a `## Human to-do` item for
  any planned step only a human can do; `flow-run` and `flow-review` write one
  the moment they find such an action, instead of prose in `## Result`. The
  three skills say so in one short paragraph with the example above.
- **Uncaptured prose is flagged.** `verify` (warning, never a failure) and
  `doctor` report a story whose `## Result` matches a human-action phrase
  (`todo.uncapturedPatterns`, default English and French: "the maintainer
  must", "to do by the user", "before (the) deploy", "in production", "à faire
  par l'utilisateur", "côté utilisateur", "avant le déploiement", "en prod")
  while it has no open `## Human to-do` item. The message names the line and
  shows the shape to write.
- **`ai-flow next` opens with We need you.** Before its recommendation, when
  anything waits on a human, `next` prints a `We need you (N)` block built from
  26-02's reader: open `## Human to-do` items, `## Needs you` questions
  (epic 20), ready `Owner: human` stories, and items under `todo.headings`.
  Order: `before: deploy` first, then `next-story` and `Needs you` questions,
  then a single count line for `later` items (`+ 4 later — ai-flow todo`).
  At most 5 lines plus the count; the full list is `ai-flow todo`.
  - The recommendation below it is unchanged (tiers 1–7).
  - `Nothing waiting on you` prints only when both the queue and the block are
    empty; with an empty queue and open to-dos it prints `No command to run —
    but we need you:` and the block.
  - `--json` adds `needsYou: [{id, when, epic, story, text, source}]`.
  - Unlike the tiers, `next` reads to-dos from **every epic of the checkout**,
    including landed ones: a landed epic is exactly where a `before: deploy`
    item is still open.
- **`ai-flow todo done <id>`** ticks that one checkbox in its file (file lock,
  no other edit) and prints the line. `todo` and `next` never tick anything on
  their own; an agent never runs `todo done` for the maintainer.
- **Said where the work leaves.** `ai-flow ship` adds a `Before you deploy`
  section to the PR body listing the open `before: deploy` items of the stories
  in the branch, and prints them. `worktree land`, `worktree autoland` and the
  epic closure (26-04) print them after landing. None of them blocks: a to-do is
  not a failure, the point is that it cannot pass unseen.
- **Status shows the count.** `ai-flow status` prints one header line
  `We need you: N (M before deploy) — ai-flow next` when N > 0.
- `/flow-next` reports the We need you block verbatim before the
  recommendation, and never runs `todo done`.

## Acceptance Criteria

- [ ] Given a story with `- [ ] (before: deploy) Run the backfill` under
      `## Human to-do`, when `ai-flow next` runs, then `We need you (1)` is
      printed above the recommendation with that line and its id.
- [ ] Given open items of all three `when` values, a `## Needs you` question
      and a ready `Owner: human` story, then `next` lists `deploy` items first,
      then `next-story` items and the question, then one `+ N later` line.
- [ ] Given no ranked command and one open to-do, then `next` prints `No command
      to run — but we need you:` and never `Nothing waiting on you`.
- [ ] Given a landed epic whose index holds an open `before: deploy` item, then
      `next` still lists it.
- [ ] Given `ai-flow todo done <id>`, then only that line becomes `- [x]` and
      neither `next` nor `todo` lists it again.
- [ ] Given a story `## Result` containing "avant le déploiement" and no open
      `## Human to-do` item, then `verify` passes with a `todo.uncaptured`
      warning naming the line, and `doctor` reports the same.
- [ ] Given a branch whose stories carry an open `before: deploy` item, then
      `ai-flow ship` prints it and the PR body has a `Before you deploy`
      section listing it; with none, the section is absent.
- [ ] Given a to-do line containing a value matching a secret pattern, then
      doctor errors and `next`/`todo` print it masked.
- [ ] Given `next --json`, then the payload holds `needsYou` with `id`, `when`,
      `epic`, `story`, `text`, `source`.

## Edge Cases

- The same text under a story and the epic index: listed once, the story wins.
- A to-do whose story or epic was deleted: not listed (nothing to read).
- `when` misspelled (`(before: prod)`): kept, treated as `later`, doctor warns
  with the three valid values.
- Many open items: `next` never prints more than 5 lines plus the count.
- A worktree checkout: `next` reads the epics of the checkout it runs from,
  like the tiers; a to-do written only in another worktree appears once that
  work lands (or from that worktree).

## Out of Scope

- Checking that a to-do is actually done (reading production env, DNS,
  accounts): it would mean reading secrets or remote state; the human ticks.
- Notifications (26-02), routing to owners or Slack (24-06).
- Blocking ship or land on open to-dos.

## Security

- Read-only except `todo done`, which edits one checkbox under a file lock.
- No secret values in to-dos: guarded at write (doctor) and masked at print.
- The ship PR body carries the to-do text only — no env values, no paths
  outside the repository.
