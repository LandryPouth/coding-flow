# Story 01-02 — Wire the Codex OS-sandbox write guard

## User value

A Codex CLI user's writes into blocked paths (the same set the Claude guard
already protects) are actually denied at the OS level — not just documented
as a rule the agent is supposed to follow.

## Requirements

- New `bin/lib/codex-settings.js`, mirroring `bin/lib/settings.js`'s
  four-state contract (`ensureHookSettings`: `"created"`/`"merged"`/
  `"upgraded"`/`"unchanged"`) but targeting `.codex/config.toml` with a
  `default_permissions` sandbox profile — ported from
  `~/dev/tools/ai-learn/bin/lib/platforms/codex-guard.js`'s `renderConfig`
  and `~/dev/tools/ai-learn/bin/lib/guard.js`'s `ensureCodexGuard` merge
  logic: **marker-gated, non-destructive**. If `.codex/config.toml` exists
  and does not start with the marker comment, it is untouched (assumed
  human- or foreign-tool-authored) — never overwritten, never merged.
- The denied-path list is the same one the Claude guard already enforces
  (`.coding-flow/harness.json`'s blocked-path config, read by
  `loadPolicy`/`blockedPathHit` in `bin/lib/guard.js:100-121,225-231`) — one
  policy, two enforcement mechanisms, not a second policy to keep in sync by
  hand.
- `ai-flow init --target codex` (from story 1) now also calls
  `ensureCodexGuard`-equivalent, same as Claude's `init` already calls
  `ensureHookSettings` (`bin/ai-flow.js:256`).
- `ai-flow upgrade` re-wires the Codex profile the same way it already
  re-wires Claude's hook (`bin/ai-flow.js:337-350`) — the sandbox profile
  can drift out of date the same way a hardcoded hook path can.
- `doctor.js`'s `checkGuardWiring` (added in a prior session, `doctor.js`
  around line 198) gains a Codex branch: presence of the marker-stamped
  `.codex/config.toml` is an error if `target === "codex"` and the file is
  missing/foreign, a warning if the profile content is stale relative to
  the current denied-path list.

## Acceptance criteria

- [ ] Given `ai-flow init --target codex` runs on a project with no
      `.codex/config.toml`, when init completes, then the file exists,
      starts with the marker comment, and its `default_permissions` profile
      denies exactly the paths `.coding-flow/harness.json` declares blocked.
- [ ] Given a project already has a `.codex/config.toml` that does not start
      with the marker, when `ai-flow init --target codex` runs, then the
      file is left byte-for-byte untouched and `doctor` does not report it
      as an error (foreign file, not our problem to fix).
- [ ] Given a marker-stamped `.codex/config.toml` from an older version,
      when `ai-flow upgrade` runs, then the file is regenerated to match the
      current denied-path list.
- [ ] Given `target === "codex"` and no `.codex/config.toml` exists at all,
      when `ai-flow doctor` runs, then it reports a `guard_not_wired`-class
      error (mirrors the existing Claude check's severity reasoning: no
      protection, silently, is worse than a stale one).

## Edge cases

- `.codex/` directory doesn't exist yet — create it (mirrors
  `ensureHookSettings`'s `mkdirSync(dirname, {recursive:true})` pattern).
- A project's `target` is `"claude"`, not `"codex"` — this story's checks
  must not fire at all (guard existing Claude-only projects' `doctor` output
  stays unchanged; regression risk to watch for explicitly in review).

## Out of scope

Confirming the sandbox actually blocks a write in a live, running Codex
session — that requires the `codex` binary and is story 3's job. This story
only has to prove the *file it writes* has the right shape and merge
behavior; story 3 proves the *mechanism* works.
