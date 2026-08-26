# Story 01-05 — Record signals from an unrecognized platform

## User value

The maintainer sees, in aggregate across real installs, how many people are
running coding-flow on a platform nobody has verified yet — and what
faint signals were actually present — instead of those installs vanishing
into "target: unrecognized" with no further information to act on.

## Requirements

- `bin/lib/detect.js` (story 1) returns `"unrecognized"` when no `--target`
  and no known signal (env var, existing `.claude`/`.codex`/etc. dir)
  matches. This story makes that outcome informative rather than a dead end.
- When `resolveTarget` returns `"unrecognized"`, `init` records a
  `platform`-kind evidence entry with `enforcementTier: "unrecognized"` and
  a **bounded, safe signal capture** — never an open-ended environment dump
  (that would risk leaking secrets from env vars). Concretely: presence
  (boolean only, never values) of a small, named allowlist of env vars this
  project already knows to look for per platform (`CLAUDECODE`, and any
  Codex/Gemini/OpenCode/Antigravity-equivalent this epic's earlier stories
  identified during their own detection work), plus which of a named
  allowlist of config directories exist (`.claude`, `.codex`, `.gemini`,
  `.config/opencode`) — never a directory listing, never file contents.
- No command/skill files are written for an unrecognized target (matches
  story 1's existing acceptance criterion — this story deepens the evidence
  captured, not the file-writing behavior, which is already "write
  nothing").
- `ai-flow report`'s `## Platform coverage` section (story 1) gains an
  `unrecognized` row when any such records exist, so the maintainer sees
  the count and the signals-seen breakdown without reading raw JSON.
- `docs/DOGFOODING.md`'s "Sending it upstream" pattern (rows worth opening
  as an issue) gets one line added pointing at this new report section as
  the way to notice "someone is on a platform we don't support yet" — this
  is a doc pointer, not new enforcement machinery.

## Acceptance criteria

- [ ] Given `ai-flow init` runs with no `--target`, no known env signal, and
      no known config directory present, when init completes, then
      `target: "unrecognized"` is recorded, no platform-specific files are
      written, and a `platform`-kind evidence record exists with
      `enforcementTier: "unrecognized"`.
- [ ] Given the same scenario but a `.codex` directory happens to exist
      without a `CLAUDECODE`/Codex-confirming signal (a partial/ambiguous
      case), when init completes, then the evidence record's signal capture
      reflects that `.codex` was present — even though detection still
      correctly returned `"unrecognized"` per story 1's resolution order
      (existing-dir detection in story 1 is scoped to `.claude`/`.codex`
      only for the platforms it already knows about; confirm during
      implementation whether this counts as "known" or "unrecognized" and
      record the decision).
- [ ] Given an evidence record's signal capture, when inspected, then it
      contains only booleans/named-allowlist membership — never a raw env
      var value, never a file listing beyond the named allowlist.
- [ ] Given one or more `unrecognized` records exist, when `ai-flow report`
      runs, then `## Platform coverage` shows an `unrecognized` row with a
      count and which signals were seen across those records.
- [ ] Given zero `unrecognized` records exist, when `ai-flow report` runs,
      then no `unrecognized` row appears (no noise for the common case).

## Edge cases

- The signal allowlist must be a small, explicit, reviewable list defined
  in code — not derived dynamically from `process.env`'s full key set (that
  would defeat the "never leak secrets" requirement by construction).
- If a future platform's signal gets added to the allowlist, old
  `unrecognized` records written before that addition must not error on
  read (the report renderer treats a missing key as "not checked", not
  "absent").

## Out of scope

Actually adding support for whatever platform shows up in these records —
that is exactly the next epic this evidence is meant to justify, decided
from real data the same way this epic itself was justified by the user
reporting real Codex/Gemini/OpenCode/Antigravity users.
