# Quickstart

Coding Flow has a lot of machinery, but you only touch a small front door. The
rest (verification, evidence, audit, guard) runs *for* you when a skill executes a
story — you rarely type it yourself.

## The whole loop

```bash
# 1. Install into the current project (once)
npx @landry_pouth/coding-flow init
```

Then, in Claude Code:

```
/plan "let users reset their password by email"   # objective -> stories
/run                                              # run the next story end-to-end
```

Back in the terminal, when you want to see state or ship:

```bash
ai-flow status     # where each story stands: planned / verified / stale / blocked
ai-flow ship       # push the branch and open (or update) the PR
```

That is 95% of daily use.

## The six skills, in workflow order

| Skill | When |
| --- | --- |
| `/setup` | Scaffold Coding Flow into the repo (once). |
| `/plan` | Turn an objective into implementation-ready stories. |
| `/run` | Execute one story: plan → code → tests → verify. Picks QUICK..STRICT by risk. |
| `/verify` | Capture verbatim pass/fail proof for a story. |
| `/review` | Findings-first pre-merge review. |
| `/ship` | Push the branch and open/update the PR. |

The depth (STRICT mode, deep validators, context scout, TDD) lives as opt-in
sections inside `/run` and `/review` — you don't chain separate skills by hand.

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
ai-flow list-skills   # the six skills, in workflow order
```

Verify a batch of stories at once and get one proof report:

```bash
ai-flow run                       # every story: verify each, one aggregated report
ai-flow run --epic epic-02-...    # just one epic
ai-flow run --story epics/.../story-02-01-...   # just one story
ai-flow run --dry-run             # show what would run, execute nothing
```

Optional hardening, only if you want it:

```bash
ai-flow ci init       # a GitHub Actions gate: no merge without a green, fresh verify
ai-flow hook install  # a local pre-push gate that runs the same check
```
