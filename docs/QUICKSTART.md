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

Back in the terminal, when you want to see state, know what to do next, or ship:

```bash
ai-flow status     # where each story stands: planned / verified / stale / blocked
ai-flow next       # the one command worth running right now
ai-flow ship       # push the branch and open (or update) the PR
```

The bare `ai-flow` form above only resolves if it is installed globally
(`npm install -g @landry_pouth/coding-flow`). `init` itself never installs
anything system-wide — it only writes files into the current project — so on
a fresh machine `ai-flow status` can fail with `command not found` even right
after `init` succeeded. Without a global install, prefix every command with
`npx` instead: `npx @landry_pouth/coding-flow status`. `init`, `upgrade`, and
`doctor` all print a `PATH:` line telling you which form works on this
machine, so you never have to guess.

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

## Two more, read-only, any time

| Skill | When |
| --- | --- |
| `/flow-status` | Where every epic and story actually stands (proof, not prose). |
| `/flow-next` | The one command worth running right now. |

Not tied to a workflow stage — reach for them whenever, from inside Claude Code,
without needing `ai-flow` on `PATH`.

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
ai-flow list-skills   # the skills, in workflow order (plus flow-status/flow-next)
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

## When the tool is the problem

Two things to reach for, and they are not the same.

```bash
ai-flow report                    # what the machine saw: denials, failures, install health
ai-flow report --out cf-report.md # write it to a file you can send
```

The report is redacted: paths are relative to the project, your home directory and
username are masked, and a detected secret is never written down — only the name of
the pattern that matched. Read it before you send it; `--raw` keeps everything if
the repository is your own.

The other half is `docs/DOGFOODING.md`, laid down by every install. The report knows
a gate fired; only you know it fired on something that was never a risk. **Write the
row in the same pass, especially when you disabled or exempted a check to keep
going** — a gate nobody can argue with is a gate that eventually gets switched off,
and that protects nothing.
