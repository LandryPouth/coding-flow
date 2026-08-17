# Claude Code Project Instructions

@RULES.md

## Coding Flow

This project uses Coding Flow skills installed in `.claude/skills/`. There is a
small, flat set. Five follow the workflow stage by stage:

- `/flow-setup` — scaffold Coding Flow into the repo (once)
- `/flow-plan` — turn an objective into implementation-ready stories
- `/flow-run` — execute one story end-to-end; it picks QUICK..STRICT by risk
- `/flow-review` — findings-first pre-merge review
- `/flow-ship` — push the branch and open/update the PR

Depth (STRICT mode, deep validators, context scout, TDD) lives as opt-in sections
inside `/flow-run` and `/flow-review` — you do not chain separate skills by hand.

Two more are read-only and not tied to a stage — reach for them any time:

- `/flow-status` — where every epic and story actually stands (proof, not prose)
- `/flow-next` — the one command worth running right now
