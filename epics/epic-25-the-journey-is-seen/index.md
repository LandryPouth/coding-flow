# Epic 25 — The journey is seen

## Goal

A UI change is proven in a browser, not only by unit tests: the `browser`
tier runs the project's own command against the app served from the story's
worktree, and when the project has no such command, a separate agent process
walks the story's `## Browser Check` in a real browser and records what it
saw — never the implementer ticking its own boxes.

## Why

- **The browser tier is a checklist today** (19-06): verify judges that the
  boxes are ticked, not that anything was looked at. bethl story 40-02's
  browser check was never done and the story still closed.
- **The maintainer already checks by hand** with Chrome DevTools and the
  existing e2e accounts; a driven run has no hands.
- **Independence**: the implementer seeing its own UI is the weakest
  witness, the same reason STRICT review is a second process (20-04).
- **Zero runtime dependency**: coding-flow ships no browser. It runs the
  project's command, or drives an agent that already has browser tools.

## Scope

**In scope**

- `validation.tiers.browser.command` (the project's own Playwright or
  script) run by verify against an app started with `ai-flow serve` (24-01)
  on a free port, health-checked, stopped after.
- In driven runs without a command: a browser-check process (fresh, no code
  edits, browser tools only) walks the checklist and writes `observed` lines
  that the tool checks.
- Test accounts declared by role, credentials read from an ignored local
  file at run time.

**Out of scope**

- Visual regression (pixel diffs), screenshots in the repository (never
  committed, by project rule on bethl).
- Creating test accounts: only declared, existing ones.
- Mobile emulators.

## Backbone

`Backbone: the browser tier runs the project's command against the served app → a fresh process walks the checklist when there is no command`

The two stories form a plain chain (25-02 reuses 25-01's serve and health
path), so there is no tree.

## Stories

1. [story-25-01-the-browser-tier-runs-a-command](story-25-01-the-browser-tier-runs-a-command/spec.md) *(STANDARD)*
2. [story-25-02-a-fresh-process-walks-the-checklist](story-25-02-a-fresh-process-walks-the-checklist/spec.md) *(STRICT — credentials handed to an agent)*

## Decisions

- **The project's command first**: a real e2e suite is cheaper and
  repeatable; the agent walk is the fallback for projects without one, and
  for checks no suite covers yet.
- **The walker never edits code**: it reports; a failed item goes back to
  the implementer like a red test (20-03 attempts).
- **Credentials never enter a prompt or a log**: the walker receives an env
  variable name per role, its browser tool fills it; events record the role,
  never the value.

## Dependencies outside this epic

Epic 19 s6 (tiers), epic 20 (driver, attempts, slots via 24-02), epic 24 s1
(`ai-flow serve`, ports).

## Readiness

`ready` as a design; the exact way a headless `claude -p` gets browser tools
(an MCP server allowed by `--allowedTools`) is verified on the installed
version inside 25-02 — a stop condition if it cannot run headless.
