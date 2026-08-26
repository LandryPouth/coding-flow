# Story 01-01 — Detect the target platform and install Codex commands

## User value

A Codex CLI user runs `ai-flow init --target codex` and gets working
coding-flow commands for their platform, the same way a Claude Code user
already does — without any Claude-specific file being written.

## Requirements

- New `bin/lib/detect.js`: `resolveTarget({flags, env, cwd})`. Resolution
  order (first to answer wins), following the philosophy already validated
  in `~/dev/tools/ai-learn/bin/lib/platforms/detect.js` — **only a confirmed
  signal counts; everything else falls through rather than guesses**:
  1. Explicit `--target claude|codex` flag.
  2. `process.env.CLAUDECODE === "1"` → `"claude"` (the one signal ai-learn
     confirmed empirically as reliable).
  3. Existing `.claude/` or `.codex/` directory at `cwd` → that platform.
  4. `"unrecognized"` — never a guess, never a crash.
- New `target` field in `.coding-flow/config.json` (`bin/lib/config.js`),
  validated against `TARGETS = ["claude", "codex", "unrecognized"]` for this
  story (`gemini`/`opencode`/`antigravity` join the set in story 4), written
  once like `skills`/`install` already are (`config.js:112-129`'s
  never-overwrite contract).
- Codex command rendering: a `bin/lib/platforms/codex.js` renderer, shaped
  like ai-learn's own (markdown + frontmatter, one file per coding-flow
  skill), but sourcing its content from this project's own
  `templates/.claude/skills/*/SKILL.md` — not copied verbatim, adapted.
- `bin/lib/templates.js` gains a platform-aware materialization path so
  `copyTemplates`/init can write Codex's flavor without touching
  `.claude/skills/`.
- A new evidence `kind: "platform"` record, written through the existing
  atomic `writeJson` (`util.js:148-152`), capturing at minimum: `target`,
  `detectionSource`, `commandsInstalled`, `enforcementTier` (`"commands-only"`
  for Codex in this story — the sandbox guard is story 2).
- `bin/lib/report.js`'s `readRuns` gains a real `kind` field read from the
  record itself, falling back to today's filename-substring heuristic only
  for records that don't declare one (no regression on existing
  `*-verify.json`/`*-evidence.json` files).
- `ai-flow report` gains a `## Platform coverage` section rendering the
  `platform`-kind records.
- `docs/design-decisions.md` gets a new entry recording this epic as a
  conscious, evidence-based freeze exception (per entry 6's own precedent:
  the premise of `docs/plans/multi-agent-install.md`'s "wait for evidence"
  stance has changed). `docs/plans/multi-agent-install.md`'s host-capability
  table gets a note that Codex's real mechanism is an OS sandbox permission
  profile, not the `PreToolUse` hook the doc originally assumed — this
  supersedes that assumption; the guard itself lands in story 2.

## Acceptance criteria

- [ ] Given a project with no `.coding-flow/config.json`, when `ai-flow init
      --target codex` runs, then `.coding-flow/config.json` records
      `target: "codex"` and the resolved Codex commands directory contains
      one rendered file per coding-flow skill (7 files).
- [ ] Given `ai-flow init` runs with no `--target`, `CLAUDECODE` unset, and
      neither `.claude/` nor `.codex/` present, when init completes, then
      `target` is recorded as `"unrecognized"` and no platform-specific
      command files are written.
- [ ] Given a Codex-targeted install just ran, when `ai-flow report` runs,
      then its output contains a `## Platform coverage` section listing
      `codex` with `enforcementTier: commands-only`.
- [ ] Given an existing `*-verify.json` evidence file written before this
      change (no `kind` field), when `ai-flow report` runs, then it is still
      classified as `kind: "verify"` — the filename fallback still works.
- [ ] Given `ai-flow init --target codex` runs twice in a row, when the
      second run completes, then no Codex command file is duplicated or
      corrupted (idempotent, matching `copyTemplates`'s existing
      skip-unless-force contract).
- [ ] Given a project already has `.claude/` from a prior Claude install,
      when `ai-flow init --target codex` runs on it, then the existing
      `.claude/` files are untouched and Codex's files are added alongside.

## Edge cases

- Codex binary not installed on the machine: command files are still
  written — writing static command files never depends on Codex being
  present (only story 3's live self-test needs the binary).
- Codex's actual convention for project-scoped vs. user-level prompts is
  not yet confirmed from this project's side (ai-learn wrote to the
  user-level `~/.codex/prompts/`); this story must confirm and record the
  choice — see `plan.md`'s Decisions slot.

## Out of scope

The sandbox guard (story 2), the automatic self-test (story 3), Gemini/
OpenCode/Antigravity (story 4), and the deeper unrecognized-platform
evidence shape (story 5 — this story only needs "recorded, no files
written" to be true, not the fuller signal-capture story 5 adds).
