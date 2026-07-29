# Coding Flow

[![npm](https://img.shields.io/npm/v/@landry_pouth/coding-flow?logo=npm)](https://www.npmjs.com/package/@landry_pouth/coding-flow)
[![CI](https://github.com/LandryPouth/coding-flow/actions/workflows/test.yml/badge.svg)](https://github.com/LandryPouth/coding-flow/actions/workflows/test.yml)
[![license](https://img.shields.io/npm/l/@landry_pouth/coding-flow)](LICENSE)

Coding Flow is an AI-native engineering workflow for developers who use **Claude Code**.

> **Claude Code first.** Coding Flow currently targets Claude Code — the skills, the plugin, and the `guard` hook are wired for it. Support for Codex and other agents is planned (per-agent targeting; see `docs/plans/multi-agent-install.md`), but not shipped yet.

Its goal is simple: make AI-assisted development more predictable, less token-hungry, and able to ship complete features in a single pass when the context is clear.

In practice, Coding Flow installs a small working system into your project. This system gives agents:

- reusable skills to plan, implement, test, and review;
- project rules shared across agents;
- a lightweight structure of epics and vertical stories;
- execution modes matched to risk: `QUICK`, `FAST`, `STANDARD`, `STRICT`;
- a context strategy to keep a simple story from consuming half a context window;
- guardrails for validation, rollback, documentation, and security evidence.

Coding Flow is not an application framework and does not replace your stack. It adds a layer of method around your repo so the agent knows what to read, what to produce, when to stop, what to validate, and how to leave a useful trace.

## Overview

The project rests on four simple blocks:

1. **The `ai-flow` CLI**
   It installs, updates, and checks the workflow files. It can also scan an existing project, list stories, and run the security harness.

2. **The context files**
   `PROJECT_RULES.md`, `AGENT_RULES.md`, `docs/project-context.md`, `docs/architecture.md`, `docs/conventions.md`, and `docs/roadmap.md` give the agent the rules and the durable map of the project.

3. **The skills**
   Skills are reusable workflows. For example `/plan-epic` breaks a product capability into stories, `/run-story` runs a story, and `/run-story-secure` adds security validations.

4. **The security harness**
   The harness makes certain guardrails checkable by the CLI: secrets, sensitive files, a story's risk level, rollback notes, and JSON evidence in `.coding-flow/runs/`.

## How It Works

The normal workflow looks like this:

```txt
1. ai-flow init
   -> installs the rules, docs, skills, examples, and the harness policy.

2. The agent reads PROJECT_RULES.md and AGENT_RULES.md
   -> it understands the boundaries, modes, and stop conditions.

3. You plan an epic or a story
   -> /plan-epic, /write-story, or /bootstrap-brownfield.

4. You run a story
   -> /quick-story, /run-story, or /run-story-secure.

5. The agent implements, tests, validates, and documents
   -> implementation-notes.md, decisions.md if needed, harness evidence if applicable.

6. ai-flow doctor / harness check can verify the install and the evidence
   -> useful locally, in CI, or before a release.
```

The important point: the user should not have to chain ten commands by hand. The `harness` commands exist for debugging and CI, but the `/run-story` and `/run-story-secure` workflows ask the agent to call them automatically when `ai-flow` is available.

## Table Of Contents

- [Getting started](#getting-started)
- [Quick install](#quick-install)
- [Overview](#overview)
- [How it works](#how-it-works)
- [10-minute start](#10-minute-start)
- [Which workflow to choose?](#which-workflow-to-choose)
- [Essential concepts](#essential-concepts)
- [Daily workflow](#daily-workflow)
- [Context and token efficiency](#context-and-token-efficiency)
- [Installed structure](#installed-structure)
- [Skills catalog](#skills-catalog)
- [Practical guides](#practical-guides)
- [Context files](#context-files)
- [Stop conditions](#stop-conditions)
- [CLI commands](#cli-commands)
- [Uninstall Coding Flow](#uninstall-coding-flow)
- [Local package development](#local-package-development)
- [GitHub distribution via npx](#github-distribution-via-npx)

## Getting Started

Coding Flow has **two layers**, installed in **two different places**. Understanding this split is the key to using the tool correctly — and the source of most early confusion.

| Layer | What it is | Where it lives | Scope | How often |
| --- | --- | --- | --- | --- |
| **Tooling** | The skills (`/plan-epic`, `/run-story`, …) and the `guard` hook | Your Claude Code configuration | **Global** — available in every project | **Once**, ever |
| **Project scaffold** | `PROJECT_RULES.md`, `docs/`, `epics/`, `.coding-flow/`, the harness policy, CI | The project's own Git repository | **Per project** | **Once per repo** |

The **tooling** is *how you work*, so it follows you across every project. The **scaffold** *describes one specific project*, so it is committed to that repository, reviewed in pull requests, and shared with your teammates and CI — including people who never open Claude Code. A global scaffold would make no sense: each project has its own rules, architecture, and backlog.

### Step 1 — Install the tooling (global, once)

Type these in the **Claude Code prompt**. They are **Claude Code slash commands** entered by you — not terminal commands, and not something the agent runs for you:

```text
/plugin marketplace add LandryPouth/coding-flow
/plugin install coding-flow
```

- `marketplace add` **registers this repository as a plugin source** on your machine (the repository is the "marketplace" — the model is decentralized, there is nothing to submit to a central store). It does not install anything on its own.
- `install` then **activates the Coding Flow plugin** from that source.

The skills and the `guard` hook become available in **every** project you open, and updates are delivered through the marketplace — no manual re-install on each release.

> The npm package that powers the `guard` hook (`@landry_pouth/coding-flow`) is fetched automatically by `npx` the first time the hook runs. **You never install it by hand.**

### Step 2 — Scaffold each project (per repo, once)

From the project directory, in a **terminal**:

```bash
npx @landry_pouth/coding-flow init
```

This writes the project structure — `PROJECT_RULES.md`, `docs/`, `epics/`, `.coding-flow/config.json`, the harness policy, and the `flow:*` scripts — **into the repository**, ready to commit and share.

### Step 3 — Work

Use the skills from Step 1 on the structure from Step 2:

```text
/plan-epic     break a capability into vertical stories
/run-story     implement a story; the guard blocks secrets automatically
```

### Which steps do I need?

| Situation | Step 1 — plugin (global) | Step 2 — `init` (per repo) |
| --- | --- | --- |
| You use Claude Code | ✅ once | ✅ once per repo |
| You only use the CLI / CI (no Claude Code) | skip | ✅ once per repo |

Two common misconceptions:

- **"I installed the plugin, so my project is ready."** No. The plugin gives you the *commands* globally, but a fresh repository has no rules, epics, or configuration for those commands to act on until you run `init` inside it.
- **"I need to install the npm package myself."** No. It is fetched automatically by `npx` (Step 2 and the `guard` hook). Conversely, `init` alone works without the plugin — the skills are copied into the repo and the hook is wired into `.claude/settings.json`.

## Quick Install

Coding Flow is available on npm (`@landry_pouth/coding-flow`) and directly from GitHub — you don't need to clone the repository to use it. This section covers the per-project CLI channel in detail; for the recommended first-time setup, see [Getting started](#getting-started).

In the project you want to equip:

```bash
npx github:LandryPouth/coding-flow init
```

`init` also adds local `flow:*` scripts to `package.json`.
If the project has no `package.json` yet, Coding Flow creates a minimal one at the root with `private: true`.
Daily use then becomes:

```bash
npm run flow:doctor
npm run flow:skills
npm run flow:status
npm run flow:check
```

`init` also creates a local cheat sheet:

```txt
.coding-flow/COMMANDS.md
```

To show the useful commands from the project:

```bash
npm run flow:commands
```

If `doctor` reports missing files:

```bash
npm run flow:fix
```

To update the Coding Flow files installed in a project without overwriting local changes:

```bash
npm run flow:upgrade -- --dry-run
npm run flow:upgrade
```

To prepare an existing project:

```bash
npx github:LandryPouth/coding-flow bootstrap --scan
```

For local package development, clone the repo then use `npm link`; see [Local package development](#local-package-development).

If the package is linked locally with `npm link`, the short `ai-flow` commands become available:

```bash
ai-flow init
ai-flow doctor
ai-flow commands
ai-flow upgrade
ai-flow status
ai-flow list-skills
ai-flow worktree add <name>|--story <dir>   # optional: parallel work (see Practical Guides)
```

By default, existing files are not overwritten. To deliberately reinstall the templates:

```bash
npx github:LandryPouth/coding-flow init --force
```

To see what would be installed without writing files:

```bash
npx github:LandryPouth/coding-flow init --dry-run
```

For output readable by CI or scripts:

```bash
npm run flow:doctor -- --json
npm run flow:status -- --json
npm run flow:skills -- --json
```

## 10-Minute Start

### Existing Project

First ask the agent to analyze the project without modifying the application:

```txt
Use /agent-planner to analyze this existing codebase and update docs/project-context.md, docs/architecture.md, docs/conventions.md, docs/roadmap.md, PROJECT_RULES.md, and AGENT_RULES.md. Do not modify application code.
```

A more context-efficient option for existing codebases:

```bash
ai-flow bootstrap --scan
```

```txt
Use /bootstrap-brownfield with docs/bootstrap-scan.md to fill project context, architecture, conventions, and roadmap. Do not modify application code.
```

Then create the first epic:

```txt
Use /plan-epic to identify the safest first vertical slice and create an implementation-ready epic with stories.
```

Then run the stories one by one:

```txt
Use /run-story in STANDARD mode for story-01-01.
```

### New Project

Clarify the product idea:

```txt
Use /grill-me to clarify the product idea, users, constraints, and first shippable value.
```

Create the initial context:

```txt
Use /agent-planner to define the initial product context, target architecture, conventions, roadmap, and project rules. Do not implement application code yet.
```

Plan the first epic:

```txt
Use /plan-epic to create epic-01 and its implementation-ready stories.
```

Launch the first story:

```txt
Use /run-story in STANDARD mode for the first story.
```

## Which Workflow To Choose?

| Situation | Recommended skill | Why |
| --- | --- | --- |
| Small isolated fix, text, local styling | `/quick-story` | Lowest context cost. No ceremony. |
| Simple story, already clear | `/run-story FAST` | Keeps a minimum of stop conditions and rollback notes. |
| Normal product feature | `/run-story STANDARD` | Good balance between one-shot, validation, and cost. |
| Auth, permissions, admin, payment, migration | `/run-story STRICT` or `/run-story-secure` | Stronger validation and better guardrails. |
| The edit point is unclear or cross-module | `/agent-context-scout` then `/run-story` | Maps the context without polluting the implementation. |
| Need to plan several stories | `/plan-epic` | Creates a vertical epic and implementation-ready stories. |
| Need to clarify the requirement | `/grill-me` | Asks the blocking questions before coding. |

Rule of thumb:

```txt
Small and obvious -> quick-story
Clear story -> FAST
Normal feature -> STANDARD
Risky or security-sensitive -> STRICT / run-story-secure
Unclear edit points -> agent-context-scout
```

## Essential Concepts

### Epic

An epic groups a small shippable product capability. It should stay short enough to start shipping quickly.

Example:

```txt
epics/epic-01-admin-content/
  index.md
  story-01-01-audit-hardcoded-content/
  story-01-02-render-first-dynamic-section/
  story-01-03-admin-edit-first-content-type/
```

### Vertical Story

A story must deliver an observable user or system outcome. It must not be split by technical layer.

Prefer:

```txt
Admin can create and publish the first content type.
```

Avoid:

```txt
Create DTOs.
Build backend.
Build frontend.
```

### Execution Packet

The Execution Packet summarizes what will be implemented, what is excluded, the validations to perform, the stop conditions, and the rollback notes.

It keeps the agent from starting to code with a fuzzy understanding of the scope.

### Context Map

The Context Map is the anti-token-waste artifact.

It indicates:

- the likely relevant files or directories;
- the searches to run first;
- the probable edit points;
- the risks to validate;
- the zones to avoid unless necessary;
- the context budget.

### Implementation Context

Each generated story contains a short `Implementation Context`. It helps Codex start in the right place, without re-reading the whole project.

## Daily Workflow

### 1. Plan

```txt
Use /plan-epic to create the next smallest shippable epic and its implementation-ready stories.
```

### 2. Choose The Mode

```txt
Use /quick-story to fix the typo in the dashboard empty state.
```

```txt
Use /run-story in FAST mode for story-02-01.
```

```txt
Use /run-story in STANDARD mode for story-02-03-admin-create-post.
```

```txt
Use /run-story-secure for story-01-02-register because it touches auth and user data.
```

### 3. Implement In One Pass

The system aims to keep the one-shot property:

```txt
understand scope -> locate edit points -> implement -> test -> validate -> document
```

The difference from a heavy workflow is that Coding Flow does not load the whole project by default. It escalates the context only when the risk justifies it.

### 4. Review

After a significant feature:

```txt
Use /review-codebase to review the latest implementation before merge.
```

For a specific risk:

```txt
Use /agent-validator-architecture to review the architecture impact.
```

```txt
Use /agent-validator-tests to review the test coverage.
```

```txt
Use /agent-validator-security to review the permission and data visibility model.
```

## Context And Token Efficiency

Coding Flow uses a context scale.

| Mode | Use when | Expected context |
| --- | --- | --- |
| `QUICK` | Tiny and obvious change | The request, `story.md` if present, 1-3 searches, targeted files. |
| `FAST` | Simple, low-risk story | Story folder, targeted files, inline stop conditions. |
| `STANDARD` | Normal feature | Compact Execution Packet, Context Map, normal validation. |
| `STRICT` | Risky change | Needed docs, Context Map, tests, architecture, security. |

`SCOUT` is not an execution mode. It is an optional pre-step:

```txt
edit points unclear -> agent-context-scout -> FAST/STANDARD/STRICT
```

Use `/agent-context-scout` when the edit point is unclear, cross-module, or when the agent would risk reading too broadly.

Default budgets:

- `QUICK`: stop after 3 searches or 5 files if the edit point stays unclear.
- `FAST`: stop after 5 searches or 8 files if the edit point stays unclear.
- `STANDARD`: create or reuse a Context Map before implementing.
- `STRICT`: read the needed docs, but search for the implementation files in a targeted way.

Important:

- Context is reduced to save tokens, not to split the feature.
- Once the edit points are clear, the agent must implement, test, validate, and document in the same pass.
- `/agent-context-scout` does not code. It only prepares a compact map.

## Installed Structure

```txt
.claude/
  skills/
    agent-context-scout/
    agent-orchestrator/
    agent-planner/
    agent-worker-fullstack/
    agent-worker-tests/

    agent-validator-architecture/
    agent-validator-quality/
    agent-validator-security/
    agent-validator-tests/

    blueprint-epic-index/
    blueprint-story/
    blueprint-tasks/
    blueprint-tests/
    blueprint-decisions/
    blueprint-implementation-notes/

    bootstrap-brownfield/
    plan-epic/
    quick-story/
    run-story/
    run-story-secure/

    grill-me/
    implement-slice/
    tdd/
    e2e-check/
    architecture-check/
    tests-check/
    quality-check/
    security-check/
    review-codebase/
    write-story/

.coding-flow/
  manifest.json
  harness.json
  COMMANDS.md
  runs/

docs/
  project-context.md
  architecture.md
  conventions.md
  roadmap.md

epics/

examples/
  epic-01-example-admin-content/

AGENTS.md
AGENT_RULES.md
PROJECT_RULES.md
CLAUDE.md
```

Claude Code discovers the skills in `.claude/skills/`.

`.coding-flow/manifest.json` lets `ai-flow upgrade` update the installed files without overwriting local changes.

`.coding-flow/harness.json` holds the lightweight security policy installed by default: blocked paths, sensitive-file patterns, expected checks, and keywords that raise a story to medium or high risk.

`.coding-flow/COMMANDS.md` is the local cheat sheet of daily commands. It saves going back to GitHub to find the right syntax.

`.coding-flow/runs/` receives the JSON evidence produced by `ai-flow harness evidence`. These files are mainly used for reviews, CI, and light audits.

`CLAUDE.md` imports the project rules:

```md
@PROJECT_RULES.md
@AGENT_RULES.md
```

## Skills Catalog

### Macro Skills

| Skill | Use |
| --- | --- |
| `/quick-story` | Run a tiny change with the minimum of context. |
| `/plan-epic` | Create a vertical epic and implementation-ready stories. |
| `/run-story` | Run a story in `FAST`, `STANDARD`, or `STRICT`. |
| `/run-story-secure` | Run a sensitive story with security validation. |

### Planning And Story Writing

| Skill | Use |
| --- | --- |
| `/grill-me` | Clarify a fuzzy requirement with targeted questions. |
| `/agent-planner` | Turn a product intent into a plan, epic, or stories. |
| `/bootstrap-brownfield` | Turn `docs/bootstrap-scan.md` into useful project docs. |
| `/write-story` | Create or refine a vertical story. |
| `/blueprint-epic-index` | Generate `index.md` for an epic. |
| `/blueprint-story` | Generate `story.md`. |
| `/blueprint-tasks` | Generate `tasks.md`. |
| `/blueprint-tests` | Generate `tests.md`. |
| `/blueprint-decisions` | Generate `decisions.md`. |
| `/blueprint-implementation-notes` | Generate or update `implementation-notes.md`. |

### Implementation And Validation

| Skill | Use |
| --- | --- |
| `/agent-context-scout` | Produce a short Context Map before a broad or fuzzy implementation. |
| `/implement-slice` | Implement a vertical story end to end. |
| `/agent-worker-fullstack` | Fullstack implementation worker. |
| `/agent-worker-tests` | Worker dedicated to tests. |
| `/tdd` | Use a targeted TDD cycle. |
| `/tests-check` | Quickly check the test coverage. |
| `/e2e-check` | Check the need for or state of E2E tests. |
| `/architecture-check` | Quickly check the architecture impact. |
| `/quality-check` | Advisory check for duplication, complexity, and convention drift. |
| `/security-check` | Quickly check the security risks. |
| `/review-codebase` | Final review before merge. |

### Deep Validators

| Skill | Use |
| --- | --- |
| `/agent-validator-architecture` | In-depth architecture review. |
| `/agent-validator-quality` | In-depth code-quality review (refactors, wide duplication). |
| `/agent-validator-tests` | In-depth test review. |
| `/agent-validator-security` | In-depth security review. |

## Practical Guides

### Fix A Small Text Error

```txt
Use /quick-story to update the dashboard empty state copy.
```

### Add A Normal CRUD Feature

```txt
Use /plan-epic to create a small epic for admin-managed posts.
```

```txt
Use /run-story in STANDARD mode for story-01-01-admin-create-post.
```

### Modify An Auth Area

```txt
Use /run-story-secure for story-01-02-register because it touches auth, validation, and user data.
```

### When The Codebase Is Too Large

```txt
Use /agent-context-scout for story-02-03 to identify relevant files, search anchors, risks, and validation focus. Do not modify files.
```

Then:

```txt
Use /run-story in STANDARD mode for story-02-03 using the Context Map.
```

### Prepare A Brownfield Project

```bash
ai-flow bootstrap --scan
```

```txt
Use /bootstrap-brownfield with docs/bootstrap-scan.md to fill project context, architecture, conventions, and roadmap. Do not modify application code.
```

Agent-only alternative:

```txt
Use /agent-planner to analyze this codebase, identify the stack, architecture, hardcoded data, coupling points, conventions, risks, and recommended first epic. Update only workflow docs. Do not change application code.
```

### See The State Of The Stories

```bash
ai-flow status
```

```bash
ai-flow status --json
```

The status is backed by executed proof, not prose. The CLI resolves it in this order:

1. an explicit `## Status <x>` section in `implementation-notes.md` (a human/author override);
2. the latest captured `ai-flow harness verify` for the story — a green run shows as `verified`, a red one as `blocked`;
3. only if no evidence exists, a fallback heuristic on the notes.

So `verified` means the machine actually ran the story's validation commands and they passed — the agent can no longer report a story as done without a captured green verify behind it. See `docs/plans/status-and-check-enforcement.md`.

When a worktree is working on a story (see `--story` below), `status` shows the mapping and lists the active worktrees — a dashboard of the parallel work in progress:

```text
epic-03-kyc
- story-03-01-kyc-upload                     in-progress   → wt: ../repo-worktrees/story-03-01-kyc-upload

Worktrees (not linked to a story):
- feat/spike-cache                           ../repo-worktrees/feat-spike-cache
```

### Parallel Work On Several Features (Worktrees)

**Optional** support to develop several genuinely independent features in parallel, each in its own working directory (Git worktree), without leaving the zero-dependency stance:

```bash
ai-flow worktree add feat/payments         # creates the worktree + branch, wires .env / deps
ai-flow worktree add --story epics/epic-03-kyc/story-03-01-kyc-upload  # branch named after the story
ai-flow worktree list                      # lists the worktrees and the state of the links
ai-flow worktree remove feat/payments      # removes the worktree, keeps the branch
```

`add` places the worktree in `../<repo>-worktrees/<name>`, symlinks `.env`/`.env.local`, and handles `node_modules` per the detected package manager (symlink for plain npm, `install` recommended for a pnpm/yarn monorepo). Options: `--from <ref>`, `--deps install|link|skip`, `--story <dir>`, `--dry-run`.

With `--story <dir>`, the branch/worktree takes the name of the story directory. The worktree↔story mapping is then **stateless**: `ai-flow status` finds it by comparing the branch name to the story directory — no mapping file to maintain. `add --story` also suggests the story's `harness preflight`.

The worktree is only useful for **parallelizable** work (disjoint code areas, stable foundation). For a list of sequential/dependent changes, roll them out one step at a time. Details and trade-offs: `docs/plans/parallel-mode.md`.

> **Why are worktrees _siblings_ (`../<repo>-worktrees/`) and not inside the repo?** A gitignored `worktrees/` *inside* the repo would still be traversed by all the tools that don't read `.gitignore`: `tsc`, eslint, jest, watchers, `docker build .`, and workspace globs (`packages/*`). Worse, `git clean -fdx` would delete it along with all uncommitted work. The sibling is out of reach of all that. The `feat/`/`fix/` categorization stays possible via the branch name (`add feat/x` → `../repo-worktrees/feat/x`).

### Open One PR Per Feature (`ship`)

From a worktree (or any feature branch), `ship` pushes the branch and opens **one** PR against the base — idempotent, one feature = one PR:

```bash
ai-flow ship                       # push + PR to the remote's default branch
ai-flow ship --base develop --draft
ai-flow ship --dry-run             # shows the plan without pushing anything
```

`ship` acts on the **current branch**, never on the local layout (a push only carries commits, never the shape of the directory — the remote repo stays a normal repo no matter what). It uses `gh` if available to create/update the PR; otherwise it pushes and prints the compare URL to open by hand. Guardrails: refuses from the base, without `origin`, or if there is no commit to ship.

## Context Files

### `docs/project-context.md`

Durable map of the project's current state.

To include:

- product summary;
- current state;
- target architecture;
- business domains;
- data model;
- user roles;
- important workflows;
- technical constraints;
- known risks;
- current roadmap;
- summary of the decisions.

To avoid:

- implementation logs;
- temporary notes;
- details of a single story;
- raw codebase audit.

### `docs/architecture.md`

Describes the boundaries, modules, data flow, architecture conventions, and important dependencies.

### `docs/conventions.md`

Describes the code, test, UI, API, naming, file, and validation conventions.

### `docs/roadmap.md`

Keeps the next product steps and the big milestones.

### Story `decisions.md`

Stores the detailed decisions of a story:

- tradeoffs;
- rejected alternatives;
- consequences;
- architecture choices;
- accepted debt.

### Story `implementation-notes.md`

Stores what actually happened:

- modified files;
- tests run;
- validations;
- rollback notes;
- problems encountered;
- follow-ups;
- remaining risks.

Rule:

```txt
project-context.md = durable state of the project
decisions.md = detailed story decisions
implementation-notes.md = real implementation history
```

## Stop Conditions

Stop the implementation instead of guessing when:

- the story scope is ambiguous;
- the acceptance criteria are not testable;
- the auth, role, or permission model is unclear;
- a breaking migration is needed;
- an external service, secret, or API contract is unknown;
- the validation commands cannot run;
- the existing architecture contradicts the request;
- security depends on a client-side-only control;
- the edit point stays unclear after the context budget.

When a stop condition triggers, the agent must explain:

- what is blocking;
- why continuing would be risky;
- which decision or piece of information is missing;
- which skill or workflow to use next.

## Good Practices For Beginners

- Start with `/agent-planner` before launching a big feature.
- Use `/quick-story` for small obvious changes.
- Use `STANDARD` by default for a real feature.
- Switch to `STRICT` as soon as the story touches auth, permissions, admin, payment, sensitive data, or migration.
- Don't ask the agent to read everything. Ask it to target the files.
- Keep the stories vertical and testable.
- Read `implementation-notes.md` after each story.

## Good Practices For Experts

- Keep epics between 2 and 5 stories.
- Use `/agent-context-scout` for cross-module areas or large codebases.
- Let `Implementation Context` carry the context details, not a huge user prompt.
- Add specific stop conditions to risky stories.
- Escalate to the deep validators only when the risk justifies it.
- Avoid pure technical stories if they don't deliver an observable behavior.
- Prefer a compact Context Map to a raw exploration of the repository.

## CLI Commands

| Command | Use |
| --- | --- |
| `ai-flow init` | Install the templates, the manifest, the project config (`.coding-flow/config.json`), and the harness policy. |
| `ai-flow init --no-branch-per-epic` | Disable the "one epic = one branch, never main" policy. |
| `ai-flow upgrade` | Update the installed files without overwriting local changes. |
| `ai-flow doctor` | Check the files, skills, frontmatter, and manifest. |
| `ai-flow doctor --fix` | Restore missing template files. |
| `ai-flow doctor --strict` | Add stricter checks on the manifest and docs. |
| `ai-flow status` | List the epics/stories, their inferred status, and the linked worktree. |
| `ai-flow worktree add <name>` | Create a worktree + branch for parallel work (wires `.env`/deps). |
| `ai-flow worktree add --story <dir>` | Same, naming the branch after the story (linked in `status`). |
| `ai-flow worktree list` | List the worktrees and the state of the `.env` links. |
| `ai-flow worktree remove <name>` | Remove a worktree, keep the branch. |
| `ai-flow ship` | Push the current branch and open/update a PR against the base (via `gh`). |
| `ai-flow bootstrap --scan` | Scan an existing codebase and write `docs/bootstrap-scan.md`. |
| `ai-flow harness init` | Create an explicit `.coding-flow/harness.json` policy. |
| `ai-flow harness preflight --story <path>` | Estimate a story's risk and list the required checks. |
| `ai-flow harness check --story <path>` | Check for secrets, sensitive files, and the minimal story evidence. |
| `ai-flow harness verify --story <path>` | Run the declared validation commands, capture the result verbatim, fail if it breaks. |
| `ai-flow harness evidence --story <path>` | Write lightweight evidence into `.coding-flow/runs/`. |
| `ai-flow guard` | PreToolUse hook: refuses (exit 2) writing a blocked path or a secret, **before** the disk. Wired into `.claude/settings.json` by `init` (`--no-guard` to skip). |
| `ai-flow audit` | Aggregate the evidence into an append-only ledger (`.coding-flow/ledger.jsonl`). |
| `ai-flow audit --export` | Write `docs/AUDIT.md` (compliance artifact) from the ledger. |
| `ai-flow audit --check` | CI gate: fails if the latest `verify` per story is red or missing. |
| `ai-flow trace [--story <path>]` | Story → commits → PR → evidence → tests chain, with the missing links. |
| `ai-flow ci init` | Scaffold a clean-room GitHub Actions workflow (`verify` + `audit --check`) into the project. |
| `ai-flow plugin sync\|check` | Sync/check the native plugin's skills against the templates. |
| `ai-flow commands` | Show the most useful commands for the current project. |
| `ai-flow uninstall` | Remove Coding Flow from the project while keeping `epics/`. |
| `ai-flow list-skills` | Show the available skills. |

After `init`, the project has easier-to-remember scripts.
If no `package.json` existed, Coding Flow creates a minimal one at the root:

| Local script | Use |
| --- | --- |
| `npm run flow:doctor` | Check the install. |
| `npm run flow:check` | Run `doctor --strict` with the quick harness checks. |
| `npm run flow:skills` | Show the available skills. |
| `npm run flow:status` | List the epics/stories. |
| `npm run flow:harness` | Run the quick harness check. |
| `npm run flow:commands` | Show the commands cheat sheet. |
| `npm run flow:uninstall` | Remove Coding Flow from the project. |

Useful commands in CI:

```bash
npm run flow:doctor -- --json
npm run flow:harness -- --json
npm run flow:status -- --json
npm run flow:skills -- --json
```

## Uninstall Coding Flow

To remove Coding Flow from a project without deleting the already-created epics and stories:

```bash
npx github:LandryPouth/coding-flow uninstall
```

The command removes:

- the files installed by Coding Flow (`AGENT_RULES.md`, `PROJECT_RULES.md`, `CLAUDE.md`, `docs/`, `.claude/skills/`, etc.);
- `.coding-flow/manifest.json`, `.coding-flow/harness.json`, `.coding-flow/COMMANDS.md`, and the harness evidence in `.coding-flow/runs/`;
- the `flow:*` scripts added to `package.json` when they match the commands generated by Coding Flow;
- the minimal `package.json` created by Coding Flow, only if it has not been enriched by the project.

The command always keeps:

- `epics/`;
- all the stories, tasks, decisions, and notes generated in the epics;
- the `flow:*` scripts that were modified manually.

To preview before deleting:

```bash
npx github:LandryPouth/coding-flow uninstall --dry-run
```

If some Coding Flow files were modified locally, they are kept by default. To force their removal:

```bash
npx github:LandryPouth/coding-flow uninstall --force
```

## Security Harness

The harness is a lightweight evidence layer. It does not replace the validation skills, but it makes certain guardrails checkable by the CLI.

It answers three questions:

- **Is the story risky?** `preflight` reads the story files and recommends `FAST`, `STANDARD`, or `STRICT`.
- **Does the repo contain dangerous signals?** `check` looks for obvious secrets, sensitive files, and missing evidence.
- **Do the tests really pass?** `verify` runs the declared validation commands (config `validation.commands`, the `## Commands` block of `tests.md`, or `package.json` scripts), captures their exit codes verbatim into `.coding-flow/runs/*-verify.json`, and fails if one breaks or if none ran. The proof is executed by the machine, not asserted by the agent.
- **Does the code meet the deterministic quality bar?** Declare `validation.quality` in `.coding-flow/config.json` (lint, format-check, a duplication detector like `jscpd`) and `verify` runs it in the same pass — a red quality command blocks exactly like a red test, so `audit --check` and `ship` cover quality for free. The tool never *judges* quality; it executes what the project declared and captures the proof. Judgment-level quality stays advisory via `/quality-check` and `/agent-validator-quality`.
- **What proves the story was handled correctly?** `evidence` writes a JSON summary with the risk, changed files, required checks, harness result, and rollback notes.

What the harness checks today:

- detection of obvious secrets;
- detection of sensitive files like `.env`, private keys, or credentials;
- story preflight to choose the right level of rigor;
- verification of the rollback notes and validation evidence on risky stories;
- JSON journal in `.coding-flow/runs/` to keep a usable trace in CI or in review.

What the harness does not do:

- it does not sandbox the agent;
- it does not intercept every shell command;
- it does not replace tests, lint, typecheck, or reviews;
- it does not guarantee that an application is secure.

Its role is more modest and more useful: catch obvious mistakes, make sensitive workflows more explicit, and leave a usable proof without weighing down the daily flow.

The daily workflow stays simple. `ai-flow init` creates the default harness policy if it doesn't exist, then the `/run-story` and `/run-story-secure` skills call the harness automatically when `ai-flow` is available. The `ai-flow harness ...` commands are mainly for debugging, CI, or one-off checks.

Optional reset in an already-installed target project:

```bash
ai-flow harness init
```

Manual examples:

```bash
ai-flow harness preflight --story epics/epic-01/story-01-01
ai-flow harness check --story epics/epic-01/story-01-01
ai-flow harness verify --story epics/epic-01/story-01-01
ai-flow harness evidence --story epics/epic-01/story-01-01
```

Production-grade testability (non-fakeable execution, negative proof, anti AI-slop discipline) is detailed in `docs/plans/testability.md`. The storage seam, project config, and branch policy: `docs/plans/storage-backends.md`.

## Evidence & Governance Layer

Beyond scanning, coding-flow turns every *advisory* guardrail into an *executed* guardrail, attached to an **identity**, aggregated into an **exportable ledger**, and verified **out of the agent's hands**. This is the answer to the real blocker of enterprise adoption: governance, audit, and compliance — not code quality. Details and design: `docs/plans/evidence-governance.md`.

- **`guard` — deterministic enforcement.** A PreToolUse hook refuses writing a `.env`, a key, or content containing a secret **before** it reaches the disk (exit 2). A secret *cannot* leak, we no longer merely hope it won't. Wired into `.claude/settings.json` by `init`, it also travels with the native plugin.
- **Provenance.** Every `verify`/`evidence` proof carries `provenance`: commit, branch, git author, *dirty* state — "asserted ≠ proven; anonymous ≠ auditable".
- **`audit` — append-only ledger.** Aggregates `.coding-flow/runs/*` into `.coding-flow/ledger.jsonl` (never rewritten). `--export` produces `docs/AUDIT.md` (the compliance artifact); `--check` is the gate "no merge without the latest `verify` green".
- **`ship` attaches the proof.** The summary of the latest `verify` (result + provenance + per-command table) is injected into the PR body, between idempotent markers — the reviewer sees "it passes, proven" without effort.
- **`trace` — end to end.** story → commits → PR → evidence → tests, flagging each missing link. "Prove that this requirement is delivered *and* verified."
- **`ci init` — clean-room gate.** A GitHub Actions workflow replays `verify` + `audit --check` on a fresh checkout: the non-gameable signal, on free compute.

```bash
ai-flow audit --export          # docs/AUDIT.md from the ledger
ai-flow audit --check           # CI gate: latest verify green per story
ai-flow trace --story epics/epic-01/story-01-01
ai-flow ci init                 # clean-room workflow in the project
```

## Install As A Native Claude Code Plugin

Coding Flow ships as a **native Claude Code plugin** — the recommended way to get the tooling globally. See [Getting started](#getting-started) for the full first-time flow; in short:

```text
/plugin marketplace add LandryPouth/coding-flow
/plugin install coding-flow
```

The plugin distributes the **tooling only** — the skills and the `guard` hook, available across all your projects and updated through the marketplace. It does **not** scaffold a repository: each project still runs `init` once to lay down its own rules, docs, epics, and configuration, which are versioned in that project's Git and shared with teammates and CI.

The two channels are complementary — npm powers the CLI and CI, the plugin delivers the IDE integration. The plugin's skills (`skills/`) are materialized from the templates by `ai-flow plugin sync` and kept drift-free by `ai-flow plugin check` (enforced in tests/CI).

## Local Package Development

### CLI Architecture (`bin/`)

`bin/ai-flow.js` is a thin dispatcher: it parses the arguments and delegates to cohesive modules in `bin/lib/`. No runtime dependencies.

| Module | Responsibility |
| --- | --- |
| `lib/context.js` | Shared constants (root, templates, cwd, npm scripts) |
| `lib/util.js` | Generic helpers (I/O, hash, JSON, paths, glob, file walking) |
| `lib/config.js` | Project config `.coding-flow/config.json` (storage, branchPerEpic, validation) |
| `lib/templates.js` | Installation, manifest, scripts, cheat-sheet, `upgrade` |
| `lib/harness.js` | Security, scan of secrets/sensitive files, preflight/check/`verify`/evidence |
| `lib/identity.js` | Git provenance (commit, branch, author, dirty, PR) injected into every proof |
| `lib/guard.js` | Deterministic PreToolUse hook (refusal of blocked paths / secrets before write) |
| `lib/settings.js` | Idempotent merge of the `guard` hook into `.claude/settings.json` |
| `lib/audit.js` | Append-only ledger, `docs/AUDIT.md` export, `--check` gate |
| `lib/trace.js` | Story → commits → PR → evidence → tests chain |
| `lib/ci.js` | Scaffolder of the clean-room CI workflow (`verify` + `audit`) |
| `lib/plugin.js` | Native plugin channel: sync/check of the skills vs templates |
| `lib/storage/` | Storage seam: `local` (default) and `github` (deferred) |
| `lib/policy.js` | "One epic = one branch, never main" policy |
| `lib/doctor.js` | Diagnostic + `--fix` |
| `lib/skills.js` | `list-skills` |
| `lib/status.js` | State of the epics/stories (via the seam) + worktrees + policy |
| `lib/bootstrap.js` | Brownfield scan |
| `lib/uninstall.js` | Uninstall preserving `epics/` |
| `lib/worktree.js` | Optional Git worktrees (parallel work) |
| `lib/ship.js` | `ship`: push of the current branch + one PR, with the `verify` proof attached |
| `lib/commands.js` | `help` and `commands` |

The dependency graph is acyclic: `context → util → config → harness → templates → {doctor, uninstall, skills, commands}`; `status` builds on `config`/`storage`/`policy`/`worktree`.

### Internal Documentation (`docs/`)

| Doc | Subject |
| --- | --- |
| [`docs/sdd-vs-plugins.md`](docs/sdd-vs-plugins.md) | From the old SDD to a plugin + governance layer: what changed, why, and what's left to publish |
| [`docs/git-worktree-bare.md`](docs/git-worktree-bare.md) | Git worktree & bare: concept, sharing `node_modules`/`.env`, when not to use it |
| [`docs/plans/parallel-mode.md`](docs/plans/parallel-mode.md) | Parallel mode (`worktree`), story link, `ship` |
| [`docs/plans/storage-backends.md`](docs/plans/storage-backends.md) | Storage seam, project config, branch policy |
| [`docs/plans/evidence-governance.md`](docs/plans/evidence-governance.md) | Evidence & governance layer: guard, provenance, audit, trace, CI, plugin |
| [`docs/plans/testability.md`](docs/plans/testability.md) | Production-grade testability: `verify`, negative proof, anti-slop |
| [`docs/plans/testing-and-ci.md`](docs/plans/testing-and-ci.md) | The package's test suite and CI |
| [`docs/plans/code-quality.md`](docs/plans/code-quality.md) | Code quality & DRY: the deterministic-vs-judgment split, the DRY-as-signal decision, and the 3 tiers |
| [`docs/plans/status-and-check-enforcement.md`](docs/plans/status-and-check-enforcement.md) | Evidence-backed story status and machine-enforced post-implementation checks (no more asking the agent to verify) |

From this repository:

```bash
node bin/ai-flow.js init --dry-run
node bin/ai-flow.js list-skills
```

`doctor` checks an install in a target project. To test `doctor`, use a temporary directory instead.

Test the install in a temporary directory:

```bash
mkdir /tmp/coding-flow-test
cd /tmp/coding-flow-test
node /path/to/coding-flow/bin/ai-flow.js init --force
node /path/to/coding-flow/bin/ai-flow.js doctor
node /path/to/coding-flow/bin/ai-flow.js doctor --json
node /path/to/coding-flow/bin/ai-flow.js commands
node /path/to/coding-flow/bin/ai-flow.js harness check --quick
node /path/to/coding-flow/bin/ai-flow.js status
node /path/to/coding-flow/bin/ai-flow.js bootstrap --scan
```

Test as a global command:

```bash
npm link
ai-flow init --dry-run
ai-flow doctor
ai-flow doctor --fix
ai-flow commands
ai-flow upgrade --dry-run
ai-flow harness check --quick
ai-flow status
ai-flow bootstrap --scan
ai-flow list-skills
```

## GitHub Distribution Via `npx`

The official distribution goes through GitHub via `npx`. The end user does not need to clone this repository:

```bash
npx github:LandryPouth/coding-flow init
npx github:LandryPouth/coding-flow doctor
```

Each `npx github:LandryPouth/coding-flow ...` call fetches the package from GitHub and runs the binary declared in `package.json`.

After `init`, the project can use the local `npm run flow:*` scripts.
If the project had no `package.json`, Coding Flow creates a minimal one to keep the commands simple.
The user therefore no longer needs to memorize the full GitHub command for common actions.

To work on the package itself, clone the repo and link the command locally:

```bash
gh repo clone LandryPouth/coding-flow
cd coding-flow
npm install
npm link
```

To update this local development install:

```bash
git pull
npm install
npm link
```

`npm pack --dry-run` stays useful to check what would be shipped in an archive.

## npm Publication (optional)

The GitHub distribution above is enough to use the tool. To publish a pinned version installable via `npx @landry_pouth/coding-flow`, the package is ready: scoped name `@landry_pouth/coding-flow`, `publishConfig.access = public`, and a `prepublishOnly` guardrail that runs the test suite before any publication.

```bash
npm login                 # once, on the @landry_pouth account
npm test                  # must be green (also run by prepublishOnly)
npm publish               # publishes @landry_pouth/coding-flow@<version>
```

> The short name `coding-flow` is already taken by a third party on npm; the `@landry_pouth/*` scope guarantees a free name with no future collision.

After publication, the install becomes `npx @landry_pouth/coding-flow init` (the `github:LandryPouth/coding-flow` commands stay valid in parallel).

## Roadmap

- `ai-flow add-epic`
- `ai-flow add-story`
- better merge with existing docs
- stricter doctor checks for cross-references between skills
- optional support for a stricter status format in the story files
