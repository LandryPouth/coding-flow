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
/flow-plan "let users reset their password by email"   # objective -> stories
/flow-run                                              # run the next story end-to-end
```

Back in the terminal, when you want to see state or ship:

```bash
ai-flow status     # where each story stands: planned / verified / stale / blocked
ai-flow ship       # push the branch and open (or update) the PR
```

That is 95% of daily use.

## The five skills, in workflow order

| Skill | When |
| --- | --- |
| `/flow-setup` | Scaffold Coding Flow into the repo (once). |
| `/flow-plan` | Turn an objective into implementation-ready stories. |
| `/flow-run` | Execute one story: plan → code → tests → verify. Picks QUICK..STRICT by risk. |
| `/flow-review` | Findings-first pre-merge review. |
| `/flow-ship` | Push the branch and open/update the PR. |

The depth (STRICT mode, deep validators, context scout, TDD) lives as opt-in
sections inside `/flow-run` and `/flow-review` — you don't chain separate skills by hand.

With the plugin installed, the same five answer to `coding-flow:flow-*` as well.
The `flow-` prefix is deliberate: Claude Code has its own `/run` and `/review`,
and a story run must never be confused with launching your app. You get the
skills from **one** channel — `init` copies them into the repo only when the
plugin is not installed, and records the choice in `.coding-flow/config.json`.

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
ai-flow list-skills   # the five skills, in workflow order
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
