# Quickstart

Coding Flow has a lot of machinery, but you only touch a small front door. The
rest (verification, evidence, audit, guard) runs *for* you when a skill executes a
story — you rarely type it yourself.

## The whole loop

```bash
# 1. Install into the current project (once)
npx github:LandryPouth/coding-flow init
```

Then, in Claude Code:

```
/plan-epic "let users reset their password by email"   # objective -> stories
/run-story                                              # run the next story end-to-end
```

Back in the terminal, when you want to see state or ship:

```bash
ai-flow status     # where each story stands: planned / verified / stale / blocked
ai-flow ship       # push the branch and open (or update) the PR
```

That is 95% of daily use.

## The three skills you actually pick

| Skill | When |
| --- | --- |
| `/plan-epic` | Turn an objective into implementation-ready stories. |
| `/run-story` | Execute one story: plan → code → tests → verify. Add `STRICT` for risky work. |
| `/quick-story` | A small, isolated change with no orchestration. |

Everything else (`/architecture-check`, `/tdd`, `/agent-validator-*`, …) is an
atomic skill that `run-story` calls when the story needs it. You don't chain them
by hand.

## What "verified" means

`ai-flow status` shows `verified` only when the machine actually ran the story's
validation commands and they passed — and only while that proof still matches the
code. Change the code afterwards and the story flips to `stale` until you re-run
the story (which re-verifies). You never have to ask the agent "did you check it?".

## When you need more

```bash
ai-flow help          # the golden path (this, in the terminal)
ai-flow help --all    # every command, grouped by role
ai-flow commands      # the easiest commands for THIS project
ai-flow list-skills   # all skills, macros first
```

Optional hardening, only if you want it:

```bash
ai-flow ci init       # a GitHub Actions gate: no merge without a green, fresh verify
ai-flow hook install  # a local pre-push gate that runs the same check
```
