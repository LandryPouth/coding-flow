# Story 01-04 — Commands for Gemini CLI, OpenCode, and Antigravity

## User value

Users on Gemini CLI, OpenCode, or Antigravity get working coding-flow
commands/skills too — with an honest, visible statement that writes are not
mechanically protected on these hosts yet, instead of silence or a false
claim.

## Requirements

- Three renderers under `bin/lib/platforms/`, adapted (not copied) from the
  validated shapes in `~/dev/tools/ai-learn/bin/lib/platforms/`:
  - `gemini.js` — TOML, `~/.gemini/commands/coding-flow/*.toml` or the
    project-equivalent location (confirm during implementation, same open
    question as story 1 had for Codex).
  - `opencode.js` — markdown + frontmatter, OpenCode's command directory
    convention.
  - `antigravity.js` — `SKILL.md` + YAML frontmatter, one directory per
    skill (Antigravity shares Gemini CLI's skill mechanism per ai-learn's
    finding — reuse that finding, do not re-derive it from scratch).
- `TARGETS` in `bin/lib/config.js` (story 1) extended with `"gemini"`,
  `"opencode"`, `"antigravity"`.
- `--target gemini|opencode|antigravity` wired into `init`, reusing story
  1's detection/materialization/evidence plumbing — **no guard wiring for
  any of the three** (`enforcementTier: "commands-only"`, matching Codex's
  tier before story 2, permanently for these three unless a future story
  finds a verified mechanism).
- `doctor`/`report` state the gap explicitly for these targets: e.g. "guard
  not available on this host" as a `doctor` **info/warning** line (not an
  error — there is nothing to fix, it's a known, permanent gap, not a
  broken install) so a user on Gemini/OpenCode/Antigravity isn't left
  wondering if something is missing versus intentionally absent.
- YAML/TOML escaping bugs are a known real risk here — ai-learn's own
  history includes a real bug (an unquoted `:` mid-description broke
  Antigravity's frontmatter, `~/dev/tools/ai-learn`'s Antigravity renderer
  comment). Reuse ai-learn's escaping functions' logic (quote descriptions,
  escape embedded quotes/backslashes) rather than re-deriving it and risking
  the same class of bug.

## Acceptance criteria

- [ ] Given `ai-flow init --target gemini` runs, when init completes, then
      the rendered TOML files parse cleanly with a strict TOML parser and
      `target: "gemini"` is recorded.
- [ ] Given `ai-flow init --target opencode` runs, when init completes, then
      the rendered markdown+frontmatter files exist at OpenCode's expected
      location and `target: "opencode"` is recorded.
- [ ] Given `ai-flow init --target antigravity` runs, when init completes,
      then one `SKILL.md` directory per coding-flow skill exists with valid
      YAML frontmatter (a description containing a mid-sentence `:` does
      not break it — the exact bug class ai-learn hit).
- [ ] Given any of the three targets, when `ai-flow doctor` runs, then it
      prints an explicit "guard not available on this host" line and this
      is never counted toward `errors` (only ever informational).
- [ ] Given any of the three targets, when `ai-flow report` runs, then
      `## Platform coverage` shows the target with `enforcementTier:
      commands-only` and no fabricated probe result.

## Edge cases

- A description string containing a literal `:`, `"`, or `\` must survive
  each renderer's escaping — test this explicitly for all three, not just
  the happy path (this is exactly where ai-learn found a real bug).
- Two of the three targets never get selected together automatically —
  `--target` remains single-select per install, same contract as story 1.

## Out of scope

Any guard mechanism for these three platforms. If one is ever found and
verified, it is a new story with its own self-test (per story 3's
precedent) — not an assumption bolted onto this one.
