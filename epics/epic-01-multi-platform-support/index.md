# Epic 01 — Multi-platform support (Codex, Gemini CLI, OpenCode, Antigravity)

## Goal

coding-flow is Claude-Code-only today (`bin/lib/guard.js`, `bin/lib/settings.js`,
`.claude/settings.json` PreToolUse hook). Real users now run on other AI coding
platforms. Give every platform commands/skills, wire a real write guard only
where a mechanism can be verified to actually work, and — new, not present in
any sibling project — make the tool self-test its own wiring automatically and
record what it found, so platforms the maintainer cannot personally test still
produce evidence instead of guesses.

## Scope

In scope: platform detection, per-platform command/skill installation, the
Codex OS-sandbox write guard (the only other platform with a validated
enforcement mechanism), an automatic self-test of that guard, an evidence
`kind` for platform wiring surfaced in `ai-flow report`, and an honest
fallback for platforms nobody has verified yet.

Out of scope: a write guard for Gemini CLI, OpenCode, or Antigravity (no
verified mechanism exists — see story 4's spec for why guessing one is
explicitly refused) — ships commands-only, gap stated out loud. Also out of
scope: any change to `decide()`'s policy logic itself in `bin/lib/guard.js`
(only what feeds it changes).

## Freeze status

This is a conscious, evidence-based exception to the feature freeze recorded
in `docs/design-decisions.md` entry 6: the premise of
`docs/plans/multi-agent-install.md`'s "no evidence yet that anyone wants
Codex/OpenCode — wait for it" has changed (real users confirmed on other
platforms). Story 1 records this formally.

## Backbone

`Backbone: an install detects its platform → gets that platform's commands →
gets a real guard if one exists and can be proven → the proof (or its
absence) becomes visible evidence, never a silent claim`

### Story dependency tree

```text
s1
├── s2 ── s3
├── s4
└── s5
```

`s1` is the walking skeleton — platform detection, config, template
materialization, and the evidence/report plumbing all get exercised end to
end for one platform (Codex, commands only). `s2`→`s3` deepen Codex with a
real guard and its automatic proof. `s4` (Gemini/OpenCode/Antigravity,
commands-only) and `s5` (the unrecognized-platform fallback) both build only
on `s1`'s detection + evidence plumbing, touch none of `s2`/`s3`'s files
(`bin/lib/codex-settings.js`, the sandbox probe), and are parallel-safe with
each other and with the `s2`→`s3` chain — each can run in its own worktree
(`ai-flow worktree add --story <dir>`).

## Stories

1. **story-01-01-detect-and-install-codex-commands** — platform detection,
   `target` config field, Codex command materialization, the new evidence
   `kind` + `## Platform coverage` report section, and the freeze-exception
   bookkeeping (`docs/design-decisions.md`, `docs/plans/multi-agent-install.md`).
2. **story-01-02-wire-codex-sandbox-guard** — port the OS-sandbox permission
   profile from `~/dev/tools/ai-learn`'s `codex-guard.js`, marker-gated,
   non-destructive, mirroring `ensureHookSettings`'s four-state contract.
3. **story-01-03-verify-codex-guard-automatically** — the live self-test:
   `codex sandbox --permissions-profile <name> -- <probe>` run inside
   `doctor`/`init`, auto-skipped when `codex` isn't on PATH, always recorded
   as evidence (pass, fail, or skipped).
4. **story-01-04-install-commands-gemini-opencode-antigravity** —
   commands/skills for the three platforms with no verified guard mechanism;
   `doctor`/`report` state the gap explicitly.
5. **story-01-05-record-unrecognized-platform-signals** — when no `--target`
   and no known signal identifies the host, record what signals *were*
   present as `kind: "unrecognized"` evidence — never wire a guessed
   mechanism.

## Readiness

**ready** — scope, sequencing, and the non-negotiable guardrails (never claim
a guard works without having executed and observed it; no mechanism ships for
a platform without one verified; every probe run is recorded regardless of
outcome) were settled with the user before this epic was written, from a
three-pass codebase research spike (this project's `guard.js`/`settings.js`/
`templates.js`/`config.js`/`plugin.js`/`report.js`, plus the sibling project's
`install.js`/`ensure.js`/`dogfood.js`/`codex-guard.js`/README capability
table). No open question remains that would change implementation.

## First story to run

`story-01-01-detect-and-install-codex-commands` via `/flow-run`.
