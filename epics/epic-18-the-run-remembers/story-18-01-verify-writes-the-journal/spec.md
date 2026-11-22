# Story 18-01 — Verify writes the journal

## User Value

Every `verify` leaves two lines in `.coding-flow/events.jsonl` — when it
started and how it ended — and `ai-flow report` shows the latest events. For
the first time, what happened between two runs is recorded by the tool that
observed it, not reconstructed from a session's memory (the 2026-11-12 bilan
was written from a session compacted hours later). This is the walking
skeleton of the journal: writer → store → reader.

## Requirements

- A new module `bin/lib/events.js` owns the journal: `appendEvent(cwd, event)`,
  `readEvents(cwd, { since, types, limit })`. Zero dependencies (`node:fs`).
- Each line is one JSON object: `v` (schema version, `1`), `at` (ISO time),
  `type`, `project` (repo directory name), `story` (repo-relative story dir or
  `null`), `actor` (`cli` for now; `driver:<runId>` later), `tree`
  (treeToken when known), and type-specific fields.
- `verify` (story and story-less) appends `verify.start` (commands count,
  command source, risk level) and `verify.end` (ok, commandsOk, duration,
  per command: command, exitCode, durationMs, timedOut, cache, and the
  evidence file name). No stdout/stderr tails in the journal: evidence keeps
  them.
- Appending never fails a verify: an I/O error prints one warning line and
  the run continues.
- Paths are repo-relative and portable (`normalizePortable`); nothing outside
  the repository is written.
- `ai-flow report` gains a `## Recent events` section (last 20 events,
  redacted like the rest of the report unless `--raw`).
- The journal sits next to `runs/` and shares its tracked-or-ignored status
  (epic decision). `init`/`upgrade` do not change `.gitignore` for it beyond
  what they do for `runs/`.
- The event schema is documented in `docs/agent-contract.md` (one short
  section: fields, types, the rule "the CLI writes, agents read").

## Acceptance Criteria

- [ ] Given a story with declared commands, when `ai-flow verify --story` runs,
      then `.coding-flow/events.jsonl` gains exactly one `verify.start` and one
      `verify.end` line, both with `v: 1`, the story path and the same tree.
- [ ] Given a verify whose commands fail, when it ends, then `verify.end`
      records `ok: false` and each command's exit code and duration, and holds
      no command output.
- [ ] Given an unwritable journal path, when verify runs, then verify's exit
      code and evidence are unchanged and one warning line is printed.
- [ ] Given a journal with events, when `ai-flow report` runs, then a
      `## Recent events` section lists the last 20, redacted by default.
- [ ] Given `docs/agent-contract.md`, then it documents the event fields and
      that only the CLI writes events.

## Edge Cases

- Two verifies in two worktrees append to their own checkout's journal; no
  cross-checkout writes in this story (18-02 carries them on land).
- A corrupt line (partial write after a kill) is skipped by `readEvents` and
  counted, never crashing a reader.
- Dry-run verify (`--dry-run`) writes no event.

## Out of Scope

- Any other event type (18-04, 18-05); metrics (epic 21); the vault.
