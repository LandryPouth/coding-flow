# Epic 21 — The factory sees itself

## Goal

`ai-flow insights` turns what the runs recorded into the numbers that say
whether the factory works — first-pass yield, noise, time in verify, what the
independent review catches, gate precision, autonomy, defects that escaped
after land — for one project and, through a Markdown vault the maintainer
owns, across every project the tool runs on.

## Why

- The baseline in `docs/plans/autonomous-factory.md` was computed on
  2026-11-12 by a throwaway script over `runs/*.json`; nothing in the tool can
  produce it again, and no one can see whether epic 19 lowered the 23–33 %
  noise.
- The only metric the research found that keeps a factory honest is the one
  nobody publishes: defects that escape after land (Goodhart counterweight;
  METR's 24-point gap between grader and maintainers). Optimising yield or
  autonomy without it teaches the tool to test less and ask less.
- Cross-project learning was asked for explicitly: a problem seen in bethl,
  ai-learn and coding-flow is a tool problem; seen in one, a project problem.
  The maintainer wants a Markdown vault (Obsidian-compatible) to hold it until
  the tool is mature enough to justify a real backend.
- Human interventions are the autonomy metric and are recorded nowhere: 1 064
  user messages in 117 bethl sessions, no split between product decisions and
  process corrections.

## Scope

**In scope**

- `ai-flow insights [--since] [--json]`, deterministic, reading the journal
  (epic 18) and backfilling from legacy `runs/*.json` so the baseline exists on
  day one.
- The vault: one path in the user's global config, `ai-flow vault init`,
  one-way sanitized export, Obsidian-friendly notes, `insights --all` across
  projects.
- Review value and gate precision from find/resolve and gate events.
- Human-turn classification of local agent transcripts (model-assisted, opt-in,
  categories only leave the machine's transcripts).
- Escaped defects and rework after `done`, from git, plus a manual incident
  event.

**Out of scope**

- Any proposal or change made from the numbers (epic 23).
- Sentry or deploy integrations (an incident is recorded by a command; an
  integration is a later story once the event shape is proven).
- Uploading anything anywhere: the vault is a local folder the maintainer may
  sync as they wish.

## Backbone

`Backbone: one project's numbers from the runs it already has → written to the vault → read across projects → the review and the gates priced → the human turns counted → the escapes traced`

The stories share `bin/lib/insights.js` and its schema, so they form a plain
chain; there is no tree.

## Stories

1. **story-21-01-insights-from-the-runs-already-recorded** *(STANDARD — walking skeleton: legacy runs + journal → metrics → terminal and `--json`)*
2. **story-21-02-a-vault-keeps-what-every-project-learned** *(STRICT — writes outside the repository; sanitization)*
3. **story-21-03-insights-across-projects** *(STANDARD)*
4. **story-21-04-the-review-and-the-gates-are-priced** *(STANDARD)*
5. **story-21-05-human-turns-are-counted** *(STANDARD)*
6. **story-21-06-escaped-defects-are-traced** *(STANDARD)*

## Decisions

- **Metrics are arithmetic, not judgement.** `insights` uses no model; same
  input, same numbers; every metric has a definition in the output and a test.
  Small samples are printed with their counts ("3 of 11"), never as bare
  percentages below 20 observations.
- **The vault is a storage seam.** Written through one module
  (`bin/lib/vault.js`), so a later backend replaces it without touching
  callers. Layout (Obsidian-compatible: YAML frontmatter, `[[wikilinks]]`, one
  note per subject):
  `coding-flow/projects/<alias>/{insights,epics,events}/`,
  `coding-flow/patterns/` (seen in ≥ 2 projects),
  `coding-flow/proposals/`, `coding-flow/experiments/` (epic 23),
  `coding-flow/playbooks/` (epic 22), and a `README.md` index.
- **One way, sanitized.** The repo writes; the vault never feeds a run directly
  (memory poisoning succeeds ~41 % across sessions in the research). Only
  repo-relative paths, metric values, categories, ids and short titles leave
  the project; no source, no command output, no transcript text; every export
  is passed through the existing secret detector and refused on a hit. A
  project gets an alias (default: directory name) the maintainer can change.
- **Absent vault is not an error.** Until a path is configured, exports are
  skipped with one line saying how to set it; no run ever fails for the vault.
- **Human-turn classification is a skill pass, not core:** `/flow-retro`
  (machinery, not front door) reads local transcripts of the sessions that ran
  an epic and writes only `human.turn` events with a category
  (`product-decision`, `process`, `correction`, `approval`, `info`).
- **Escape = a `fix` commit within 14 days of a story's land that touches files
  the story changed**, plus incidents recorded with `ai-flow event incident
  --story <dir> --ref <url-or-id>`. Heuristic, labelled as such.

## Maintainer to-do

- ~~Give the path of a new Markdown vault~~ — **done 2026-11-12**:
  `~/dev/.ai-memory-vault`, a fixed path, its own private git repository,
  scaffolded with the `coding-flow/` layout, human zones (`Home.md`,
  `inbox/`, `preferences/`, `_templates/`) and an agent contract
  (`AGENTS.md`). 21-02 adopts it: `ai-flow vault init ~/dev/.ai-memory-vault
  --adopt`.
- Optionally choose project aliases (default: directory names).

## Readiness

`ready` for s1–s6. The vault path was given on 2026-11-12 (above).
