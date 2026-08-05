# Claude Code Project Instructions

@RULES.md

## Coding Flow

This project uses Coding Flow skills installed in `.claude/skills/`. There is a
small, flat set — one per stage of the workflow:

- `/flow-setup` — scaffold Coding Flow into the repo (once)
- `/flow-plan` — turn an objective into implementation-ready stories
- `/flow-run` — execute one story end-to-end; it picks QUICK..STRICT by risk
- `/flow-verify` — capture verbatim pass/fail proof for a story
- `/flow-review` — findings-first pre-merge review
- `/flow-ship` — push the branch and open/update the PR

Depth (STRICT mode, deep validators, context scout, TDD) lives as opt-in sections
inside `/flow-run` and `/flow-review` — you do not chain separate skills by hand.
