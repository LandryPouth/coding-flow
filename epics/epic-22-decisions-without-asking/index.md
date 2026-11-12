# Epic 22 — Decisions without asking

## Goal

An agent decides what the project has already decided, notes what it decides
alone, and asks only what only a human can answer — because the project says
so in a short policy file, because past decisions are searchable with their
provenance, and because a finding the reviewers keep repeating climbs into a
convention, then a lint rule or a test, then a gate. The house style and the
architecture choices become something the tool reads and enforces, not
something one person's agent remembers.

## Why

- **The policy exists only in prose and in one person's agent memory.** On
  bethl, "land = local merge", "never the main checkout", "2 stories max in
  parallel", "never create test accounts", "UI sober, one accent", "shadcn
  first" live in ~30 Claude memory files. A teammate's agent never sees them;
  coding-flow and ai-learn re-learn them (bethl DOGFOODING bilan, P1).
- **Minor decisions stop epics.** The bilan's three levels — *Décide*,
  *Décide et note*, *Demande* — were applied by hand in epic 39 (39-02 D4–D15,
  39-03 D9–D19: dozens of decisions taken alone, each one correct only because
  the orchestrator was watching).
- **What the research allows memory to be:** context files loaded every
  session give no significant gain and cost > 20 % more inference (ETH Zurich,
  ICLR 2026), except for non-standard conventions; memory poisoning succeeds
  ~41 % across sessions; the only production pattern that works is "agent
  proposes, human promotes". Devin's Knowledge, Claude's `/doctor
  prompt-audit` and the Darwin Gödel Machine's hidden evaluator all keep the
  promotion outside the agent.
- `ai-flow audit --decisions` already harvests `## Decisions` into
  `docs/DECISIONS.md`; nothing searches it, and nothing records who decided.

## Scope

**In scope**

- `.coding-flow/autonomy.md`: topics × level, an owner per topic, read by
  `/flow-plan` and `/flow-run`; `ai-flow decide` records a `decision.made`
  event and the story's Decisions line.
- A decision registry with topic, paths, provenance and status, searched on
  demand (`ai-flow decisions search`), never injected whole.
- The promotion ladder for review findings.
- Moving agent-memory preferences into the repo, one approved item at a time.
- Playbooks proposed from runs that worked, approved before use.
- A personal preference profile in the vault (`preferences/`), proposed to
  each project and accepted line by line (two levels: person, project).
- Declared conformance checks (design system, conventions) on added lines.

**Out of scope**

- Any rule applied without a human promoting it.
- Long `CONVENTIONS.md` files: an entry that restates the framework's default
  is refused by the ladder.
- Team routing of questions (epic 24 s5).

## Backbone

`Backbone: the project says who decides → past decisions are found with their provenance → a repeated finding climbs the ladder → personal memory moves into the repo → a run that worked becomes a playbook → a personal taste is proposed to each project → the design system is a check`

The stories form a plain chain over the same policy and registry modules; no
tree.

## Stories

1. **story-22-01-the-project-says-who-decides** *(STANDARD — walking skeleton: `autonomy.md` → read by `/flow-run` → `ai-flow decide` → event + Decisions line → listed in the epic report)*
2. **story-22-02-precedents-are-searched-not-loaded** *(STANDARD)*
3. **story-22-03-a-repeated-finding-climbs-the-ladder** *(STANDARD)*
4. **story-22-04-agent-memory-moves-into-the-repo** *(STANDARD — dogfooded on bethl)*
5. **story-22-05-a-run-that-worked-becomes-a-playbook** *(STANDARD)*
6. **story-22-06-a-personal-taste-is-proposed-to-each-project** *(STANDARD — the vault's `preferences/` offered to each project, accepted line by line; the project wins)*
7. **story-22-07-the-design-system-is-a-check** *(STANDARD — `validation.conformance`: forbidden patterns on added lines, `warn` then `block`; the ladder's `gate` rung)*

## Decisions

- **Three levels, the bilan's:** `decide` (silent), `decide-and-note` (recorded,
  surfaced in the epic report), `ask` (the story parks with `## Needs you`; the
  epic continues). Defaults when a topic is absent: `ask` for product or
  business rules, money, production and push, destructive migrations,
  permissions, external services or cost, personal data; `decide-and-note` for
  deviations from the plan that change no product rule; `decide` for process.
- **A precedent can lower `ask` to `decide-and-note` only if the policy allows
  it for that topic** and the precedent is `accepted` (human-authored or
  human-approved). An agent-written decision is a `proposed` precedent until
  reviewed. Provenance (story, commit, author kind, date) travels with it.
- **Ladder rungs:** finding category seen in 3 distinct stories → proposed
  convention entry (one line, non-standard only, with the findings that
  justify it) → proposed lint rule or test → proposed gate. Each step is a
  proposal; acceptance is a human edit, recorded.
- **No universal canon (added 2026-11-12):** the tool learns this
  maintainer's choices, not a book's — Clean Code's tiny functions contradict
  the deep-modules rule bethl already states. Taste lives in the vault
  (person), conventions in the repo (project); the project wins, and a rule
  is worth most once a check enforces it (22-07), not when an agent reads it.
- **Personal vs project:** anything about this repository moves to the repo;
  what is about one person's taste (language of replies, tone) stays in their
  agent memory. Epic 24 s6 formalises the precedence.

## Readiness

`ready`. Assumption (default, open to veto): the policy file is Markdown with
one table (`topic | level | owner | note`), not JSON, because agents and
humans both read it and nothing computes on it beyond a lookup.
