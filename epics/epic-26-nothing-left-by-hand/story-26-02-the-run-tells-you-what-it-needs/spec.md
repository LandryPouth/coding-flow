# Story 26-02 — The run tells you what it needs

## User Value

The maintainer stops watching: a run that needs an answer, is blocked, is
paused on a usage limit, or ends calls a command they chose (a desktop
notification, a phone push), and `ai-flow todo` lists in one place
everything waiting on a human across all epics — the to-dos that today live
in epic indexes and agent memory and are recalled by hand.

## Requirements

- `notify.command` in the user's global config (`~/.config/coding-flow/
  config.json`), never in the project: run with the event as JSON on stdin
  for `notify.events` (default `["needs-you", "blocked", "paused",
  "run.end", "epic.landed"]`). Timeout 10 s; a failing or slow command is
  logged (`notify.failed`) and never stops the run.
- The event carries: event, project, epic, story, one-line summary, the
  `REPORT.md` path and the next command (`ai-flow todo`, `run --resume`).
  Never env values, never finding bodies.
- Documented examples in `docs/rules-and-limits.md`: `notify-send`
  (Linux), a PowerShell toast from WSL, an `ntfy` push.
- `ai-flow todo [--json]`: read-only, across all epics: `## Needs you`
  questions; stories `Owner: human` that are ready; maintainer to-do items
  from epic indexes (headings from `todo.headings`, default `["Maintainer
  to-do", "Maintainer cleanup on delivery"]`, unchecked `- [ ]` lines);
  deferred criteria `[~]`; open browser checks; open risks (26-01). Grouped
  by epic, oldest first.
- The reader behind `ai-flow todo` is one module (`bin/lib/todo.js`) that
  26-07 extends: the `## Human to-do` shape with `when`, `ai-flow todo done`,
  and the **We need you** block that `ai-flow next` prints first.

## Acceptance Criteria

- [ ] Given `notify.command` set and a story parking on `Needs you`, then the
      command runs once with the event JSON on stdin.
- [ ] Given a notify command that hangs, then it is killed at 10 s, logged,
      and the run continues.
- [ ] Given a project `config.json` declaring `notify.command`, then it is
      ignored and doctor warns.
- [ ] Given two epics with unchecked maintainer to-do items and a `Needs you`
      story, then `ai-flow todo` lists all three, grouped by epic.
- [ ] Given `todo.headings` set to a project's own heading (bethl: "À faire
      côté utilisateur"), then those items are listed too.

## Edge Cases

- No notify command: nothing runs; `run.end` prints the todo count.
- A to-do checked `[x]`: not listed.

## Out of Scope

- Routing to owners, Slack, email (24-06).
- Capturing human to-dos as they appear, `next`'s We need you block, and
  ship/land repeating `before: deploy` items: 26-07.

## Security

- The command comes only from the user's config: a repository cannot make
  anyone run a command. The payload holds no secrets and no agent text
  beyond the one-line summary written by the CLI.
