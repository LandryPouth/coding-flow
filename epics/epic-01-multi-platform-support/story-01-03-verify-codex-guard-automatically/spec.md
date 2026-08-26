# Story 01-03 — Automatic, executed self-test of the Codex guard

## User value

Nobody has to take coding-flow's word that the Codex sandbox profile
actually blocks a write. `ai-flow doctor`/`ai-flow init` try it for real and
say what happened — this is the feature neither coding-flow nor the sibling
reference project (`~/dev/tools/ai-learn`) has today: there, "verified with
`codex sandbox`" is a comment describing a command the human author ran once
by hand, never something the shipped tool runs itself.

## Requirements

- A probe function that shells out to
  `codex sandbox --permissions-profile <profile-name> -- <probe-cmd>` (the
  exact invocation ai-learn's author validated manually, per
  `~/dev/tools/ai-learn/bin/lib/platforms/codex-guard.js:9-15`), where
  `<probe-cmd>` attempts a write to a path the profile denies (e.g. a
  temp file under the first blocked glob) and the probe checks the command
  **failed** (write denied) — success/allow would mean the sandbox isn't
  enforcing, which is the failure mode this exists to catch.
- Runs automatically inside `ai-flow doctor` and `ai-flow init`, per the
  decision made with the user — no separate command to remember, no
  `--strict` gate.
- Auto-skipped, never failed, when the `codex` binary is not on `PATH` —
  mirrors `~/dev/tools/ai-learn/test/integration-opencode.test.js`'s
  `{skip: !opencodeAvailable()}` pattern, promoted here from a maintainer
  test into shipped, automatic, end-user-facing behavior.
- Every run — pass, fail, or skipped-no-binary — is recorded as a
  `platform`-kind evidence record (from story 1) with a new
  `probe: {ran, ok, detail}` field. `enforcementTier` becomes `"sandbox"`
  only when a probe has actually run and passed; it must never read
  `"sandbox"` from config presence alone (that would be exactly the false
  claim this story exists to prevent).
- `ai-flow report`'s `## Platform coverage` section (story 1) shows the
  probe outcome per target, not just that a target was seen.
- `doctor`'s human-readable output states the probe result in plain
  language: confirmed-working, confirmed-broken (with the denial detail),
  or not-checked-codex-not-installed — three distinct messages, never
  collapsed into one "guard wired" line.

## Acceptance criteria

- [ ] Given `codex` is on `PATH` and the sandbox profile from story 2 is
      correctly wired, when `ai-flow doctor` runs, then it executes the
      probe, the probe's write attempt is denied, and the platform evidence
      record has `probe: {ran: true, ok: true}`.
- [ ] Given `codex` is on `PATH` but the sandbox profile is missing or
      misconfigured (denies nothing), when `ai-flow doctor` runs, then the
      probe's write attempt succeeds, `doctor` reports this as an **error**
      (not a warning — a false sense of protection is the worst outcome),
      and the evidence record has `probe: {ran: true, ok: false}`.
- [ ] Given `codex` is not on `PATH`, when `ai-flow doctor` runs, then no
      `codex` process is spawned, `doctor` exits with its normal status
      (this alone is never an error), and the evidence record has
      `probe: {ran: false}`.
- [ ] Given the probe ran and passed, when `ai-flow report` runs, then
      `## Platform coverage` shows `codex` with a confirmed-working
      enforcement tier, not merely "commands installed."
- [ ] Given `doctor` runs twice in a row on an unchanged, correctly-wired
      project, when comparing the two runs, then both complete in a
      reasonable time for a command run routinely (the probe spawns at most
      one `codex` process per run — no retry storm, no hang without a
      timeout).

## Edge cases

- The probe must have a bounded timeout (mirror the guard hook's own
  `GUARD_TIMEOUT` reasoning in `settings.js:37-41` — insurance against a
  hung subprocess, not a tight budget) and must never let a hang block
  `doctor`/`init` indefinitely.
- The probe's write target must be safely disposable (a temp path under the
  denied glob, cleaned up regardless of the probe's outcome) — it must never
  leave stray files in the project.
- Running on a machine where `codex` exists on `PATH` but is not
  authenticated/configured (Codex may prompt or fail for unrelated reasons)
  must be distinguished from "sandbox didn't deny" — an unrelated Codex
  failure should surface as `probe: {ran: true, ok: null, detail: "codex
  itself failed unrelated to the sandbox"}`, not be misread as either a pass
  or a guard failure.

## Out of scope

Gemini/OpenCode/Antigravity probes (no enforcement mechanism exists yet for
them — story 4 ships commands-only; a probe for a mechanism that doesn't
exist has nothing to test).
