# Story 18-03 — A notes-only edit keeps the proof

## User Value

Writing the `## Result` or ticking a task after a green verify no longer turns
the proof `stale` and forces a 3–9 minute rerun that says nothing new (bethl
bilan P1: "changer seulement les notes ne relance pas les commandes"). Any
edit that could change what the story claims still restales.

## Requirements

- The story digest used for freshness (`storyDigest` in `bin/lib/evidence.js`)
  excludes exactly:
  - the body of `## Result` (including `### Rollback Notes`) in `tasks.md` or
    in a single-file `story.md`;
  - the checkbox state (`[ ]` / `[x]` / `[~]`) of lines under `tasks.md`'s
    task list.
- Everything else still counts: `spec.md`, acceptance-criteria text and their
  checkbox state (18-06 binds those), `plan.md` (including `## Commands`),
  `## Test Exemption`, `## Deferred Criteria`, `## Status`, and any file
  outside the story directory.
- Evidence records the digest version (`storyDigestVersion: 2`); evidence
  with the old digest is judged with the old rule, so no existing proof turns
  fresh by the upgrade (signals only lower claims).
- `ai-flow verify` on a story whose only change since the last green run is
  notes-only replays the proof (as for an unchanged story) and says
  `notes-only change since the last run`.

## Acceptance Criteria

- [ ] Given a green verify, when only the `## Result` section of `tasks.md` is
      edited, then `ai-flow status` still shows the story `verified`.
- [ ] Given a green verify, when a task checkbox in `tasks.md` is ticked, then
      the proof stays fresh.
- [ ] Given a green verify, when an acceptance criterion's text or checkbox in
      `spec.md` changes, or `## Commands` changes, then the proof is `stale`.
- [ ] Given evidence written with the previous digest, when status runs after
      an upgrade, then its freshness is computed by the previous rule.
- [ ] Given a notes-only change, when verify runs, then it replays and prints
      the reason.

## Edge Cases

- A `## Result` heading missing or duplicated: the whole file counts (fail
  closed).
- A code file named inside `## Result` is just text; the code itself is
  covered by the tree token, not the digest.

## Out of Scope

- Notes outside the story (`DOGFOODING.md`, `CHANGELOG.md`): they are already
  outside behavior globs or not; this story does not change the tree token.

## Security

Freshness is a claim: the rule is an exclusion list, fail-closed on any parse
doubt, with a test for each excluded and each still-counted section.
