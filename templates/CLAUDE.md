# Claude Code Project Instructions

@PROJECT_RULES.md
@AGENT_RULES.md

## Coding Flow

This project uses Coding Flow skills installed in `.claude/skills/`.

A portable mirror is also installed in `.agents/skills/` for Codex and other agents that do not auto-discover Claude Code project skills.

Prefer the macro workflows for daily work:

- `/plan-epic`
- `/quick-story` — isolated changes, no orchestration
- `/run-story`
- `/run-story-secure`

Use atomic skills when a specific phase needs focused attention.
