# Claude Code Project Instructions

@RULES.md

## Coding Flow

This project uses Coding Flow skills installed in `.claude/skills/`. There is a
small, flat set — one per stage of the workflow:

- `/setup` — scaffold Coding Flow into the repo (once)
- `/plan` — turn an objective into implementation-ready stories
- `/run` — execute one story end-to-end; it picks QUICK..STRICT by risk
- `/verify` — capture verbatim pass/fail proof for a story
- `/review` — findings-first pre-merge review
- `/ship` — push the branch and open/update the PR

Depth (STRICT mode, deep validators, context scout, TDD) lives as opt-in sections
inside `/run` and `/review` — you do not chain separate skills by hand.
