# Coding Flow

[![npm](https://img.shields.io/npm/v/@landry_pouth/coding-flow?logo=npm)](https://www.npmjs.com/package/@landry_pouth/coding-flow)
[![CI](https://github.com/LandryPouth/coding-flow/actions/workflows/test.yml/badge.svg)](https://github.com/LandryPouth/coding-flow/actions/workflows/test.yml)
[![license](https://img.shields.io/npm/l/@landry_pouth/coding-flow)](LICENSE)

Coding Flow makes **Claude Code** reliable on real projects: the machine runs your tests and shows `verified` only when they *actually* passed — not when the agent says they did.

> **Claude Code first.** Coding Flow currently targets Claude Code — the skills, the plugin, and the `guard` hook are wired for it. Support for Codex and other agents is planned (see [`docs/plans/multi-agent-install.md`](docs/plans/multi-agent-install.md)), but not shipped yet.

**What you get over plain Claude Code + a good `CLAUDE.md`:** the `guard` hook refuses to write a `.env`, a key, or a secret **before it reaches the disk** (a leak *can't* happen, you don't merely hope it won't) — plus executed proof instead of the agent's word, fewer forgotten files, and less context burned per change. When you want it, the same executed proof doubles as an audit/evidence layer for teams that need governance. That machinery runs *for* you underneath a tiny front door; you rarely type it yourself.

Coding Flow is **not** an application framework and does not replace your stack. It installs a small working system around your repo so the agent knows what to read, what to produce, when to stop, what to validate, and how to leave a useful trace.

> **In a hurry?** The front door is small: install the plugin once, run `/flow-setup` (or `ai-flow init`) once per repo, then `/flow-plan` and `/flow-run` in Claude Code. Everything else is machinery the skills run for you. See **[docs/QUICKSTART.md](docs/QUICKSTART.md)** — the whole loop on one screen.

> **Start light.** Most work is `/flow-run` on a small change — a request and a targeted change, no paperwork. `/flow-run` picks its intensity from the story's risk; the heavier artifacts (Execution Packet, Context Map, the multi-point stop conditions) **only appear at `STANDARD` and `STRICT`**, and you opt into that rigor when the risk earns it. You do not fill out a packet to add a field to a form.

## Table Of Contents

- [How it works](#how-it-works)
- [Getting started](#getting-started)
- [Choosing the mode](#choosing-the-mode)
- [Core concepts](#core-concepts)
- [Skills catalog](#skills-catalog)
- [The reliability layer](#the-reliability-layer)
- [Working day to day](#working-day-to-day)
- [Context & story files](#context--story-files)
- [Stop conditions](#stop-conditions)
- [CLI commands](#cli-commands)
- [Uninstall](#uninstall)
- [Documentation](#documentation)

## How It Works

Coding Flow rests on four blocks:

1. **The `ai-flow` CLI** — installs, updates, and checks the workflow files; scans existing projects; runs the security harness.
2. **The context files** — `RULES.md` and `docs/` give the agent the rules and a durable map of the project.
3. **The skills** — a small, flat set of reusable workflows, one per stage: `/flow-setup`, `/flow-plan`, `/flow-run`, `/flow-verify`, `/flow-review`, `/flow-ship`. They are **structured prompts Claude Code reads and follows** — depth (STRICT mode, deep validators, context scout) lives as opt-in sections inside `/flow-run` and `/flow-review`, not as separate skills. There is no orchestration at runtime.
4. **The security harness** — a set of **CLI checks over your repo and story files** (not a sandbox): secrets, sensitive files, a story's risk level, rollback notes, and JSON evidence in `.coding-flow/runs/`.

The daily loop:

```txt
init once  →  /flow-plan  →  /flow-run (add STRICT for sensitive work)  →  /flow-review  →  /flow-ship
```

You never chain ten commands by hand: the `/flow-run` skill calls the harness automatically when `ai-flow` is available.

## Getting Started

Coding Flow has **two layers**, installed in **two different places**. This split is the key to using the tool correctly — and the source of most early confusion.

| Layer | What it is | Where it lives | How often |
| --- | --- | --- | --- |
| **Tooling** | The skills (`/flow-plan`, `/flow-run`, …) and the `guard` hook | Your Claude Code config — **global** | **Once**, ever |
| **Project scaffold** | `RULES.md`, `docs/`, `epics/`, `.coding-flow/`, CI | The project's own Git repo — **per project** | **Once per repo** |

The **tooling** is *how you work*, so it follows you everywhere. The **scaffold** *describes one project*, so it is committed, reviewed in PRs, and shared with teammates and CI.

**Step 1 — install the tooling (global, once).** In the Claude Code prompt:

```text
/plugin marketplace add LandryPouth/coding-flow
/plugin install coding-flow
```

`marketplace add` registers this repository as a plugin source (the model is decentralized — nothing to submit to a central store); `install` activates the plugin. The skills and `guard` hook are then available in **every** project, updated through the marketplace.

**Step 2 — scaffold each project (per repo, once).** Easiest, without leaving Claude Code:

```text
/flow-setup
```

It runs `init` for you (non-destructive) and points you to `/flow-plan`. The terminal equivalent is `npx @landry_pouth/coding-flow init`, which writes `RULES.md`, `docs/`, `epics/`, `.coding-flow/config.json`, and the `flow:*` scripts into the repo, ready to commit.

**Step 3 — work.**

```text
/flow-plan     break a capability into vertical stories
/flow-run      implement a story; the guard blocks secrets automatically
```

**Do I need both steps?** If you use Claude Code, yes — Step 1 once, Step 2 per repo. If you only use the CLI/CI (no Claude Code), skip Step 1 and just run `init` per repo. Two misconceptions to avoid:

- **"I installed the plugin, so my project is ready."** No — the plugin gives you the commands globally, but a fresh repo has nothing for them to act on until `init` runs inside it.
- **"I need to install the npm package myself."** No — `npx` fetches it automatically (Step 2). The `guard` hook then runs that package's binary **directly from disk** (bundled with the plugin, or resolved when `init` runs) — it never re-fetches through `npx` on every write, so it stays fast even offline.

### One Skill, One Name

The skills can reach you through either layer — the plugin (as `coding-flow:flow-run`) or the project's own `.claude/skills/` (as `/flow-run`). Getting **both** would leave you with two commands doing the exact same thing, so you never do:

- `init` detects the plugin. Installed → it skips the copy, and the plugin serves the skills. Absent → it copies them into the repo, so a teammate who clones without the plugin still gets the workflow.
- The decision is written to `.coding-flow/config.json` as `"skills": "plugin" | "project"` and **committed**. Every later command reads that record instead of re-detecting, so the install cannot behave differently on your machine and your teammate's.
- Override it whenever you want: `init --with-skills` / `--no-skills`, or `upgrade --with-skills` / `--no-skills` to switch an existing repo. Switching to the plugin removes the project copies (a file you edited yourself is reported and kept, never deleted).
- **Already installed? Just `upgrade`.** A project from before this release has no recorded choice, so the first `upgrade` makes it — detecting, recording it, and removing the now-duplicated copies. No second `init`, no flag. A project that *has* a recorded choice is never second-guessed, even on a machine that would detect otherwise.

**What if the detection is wrong?** It is built to fail in the harmless direction. A plugin counts as installed only when the skills it would serve are visible on disk — a name in Claude Code's registry is a claim, not evidence. So a corrupt or unfamiliar config, a registry entry left behind by an uninstall, a half-finished install, or a cache directory that survived a removal all resolve to "no plugin", and you get the project copy: at worst two names for one skill, never zero. The reverse — skipping the copy while nothing serves the skills — is the outcome that would actually break your workflow, and it takes a real plugin, with real skills, declaring itself in its own manifest. `init` and `upgrade` always print which channel won and why. Every one of these cases is a test in `test/plugin-detect.test.js`.

**Why `flow-` at all?** Claude Code ships its own `/run` and `/review`. A skill named `run` would sit right next to a built-in that does something completely different — "launch the app" versus "execute a story". The prefix makes each command mean exactly one thing.

## Choosing The Mode

`/flow-run` picks its intensity from the story's risk, but you can name it. One skill, four intensities:

| Situation | Command | Why |
| --- | --- | --- |
| Small isolated fix, text, local styling | `/flow-run` (QUICK/FAST) | Lowest context cost. No ceremony. |
| Normal product feature | `/flow-run STANDARD` | Balance of one-shot, validation, and cost. |
| Auth, permissions, admin, payment, migration | `/flow-run STRICT` | Stronger validation and security checks. |
| Edit point unclear or cross-module | `/flow-run` (scout pre-step) | Maps the context without polluting the implementation. |
| Plan several stories | `/flow-plan` | Creates a vertical epic and implementation-ready stories. |
| Clarify a fuzzy requirement | `/flow-plan` (Clarify First) | Asks the blocking questions before coding. |

`SCOUT` is not an execution mode — it is an optional pre-step inside `/flow-run` for unclear or cross-module edit points. Context is reduced to save tokens, never to split the feature: once the edit points are clear, the agent implements, tests, validates, and documents in the **same pass**.

## Core Concepts

- **Epic** — a small shippable product capability, short enough to start shipping quickly. Folders: `epics/epic-NN-name/`.
- **Vertical story** — delivers an observable user or system outcome; never split by technical layer ("Admin can create and publish a post", not "Create DTOs / Build backend / Build frontend"). Folders: `story-NN-MM-name/`.
- **Execution Packet** *(STANDARD/STRICT only)* — scope, exclusions, validations, stop conditions, rollback notes. Keeps the agent from coding with a fuzzy scope.
- **Context Map** *(STANDARD/STRICT only)* — the anti-token-waste artifact: likely files, searches to run first, probable edit points, risks, zones to avoid, context budget.
- **Implementation Context** — a short block in each generated story that helps the agent start in the right place without re-reading the whole project.

## Skills Catalog

A small, flat set — one skill per stage of the workflow. You pick any of them directly; there is no macro/atomic hierarchy to chain by hand.

| Skill | Use |
| --- | --- |
| `/flow-setup` | Scaffold Coding Flow into the current repo from Claude Code (once per repo). |
| `/flow-plan` | Turn an objective into a vertical epic and implementation-ready stories. Includes opt-in sections for clarifying fuzzy requirements and bootstrapping a brownfield codebase. |
| `/flow-run` | Execute one story end-to-end. Picks QUICK/FAST/STANDARD/STRICT by risk; STRICT adds security validation. Context scout and TDD are inline modes. |
| `/flow-verify` | Run the declared validation commands and capture verbatim pass/fail as tamper-evident proof. `/flow-run` calls it automatically. |
| `/flow-review` | Findings-first pre-merge review. Each dimension (architecture, tests, security, quality, E2E) has an opt-in deep section for high-risk work. |
| `/flow-ship` | Push the branch and open/update one PR, with the latest verify evidence attached. |

The depth that used to live in separate `agent-*` and `*-check` skills — the deep
validators, the multi-agent worker roles, the context scout, TDD — is **not gone**;
it moved into opt-in sections of `/flow-run` and `/flow-review`, so nothing capable was lost
while the front door shrank from thirty skills to six.

## The Reliability Layer

The harness turns *advisory* guardrails into *executed* ones, attached to an identity and verified out of the agent's hands. It does **not** sandbox the agent, intercept every shell command, replace your tests/lint/reviews, or guarantee an app is secure — it catches obvious mistakes and leaves usable proof.

- **`guard` — deterministic enforcement.** A PreToolUse hook refuses writing a `.env`, a key, or content containing a secret **before** it reaches the disk (exit 2). Wired into `.claude/settings.json` by `init`; also travels with the plugin. It runs the package's own binary, resolved locally at install — no `npx` in the write path, so enforcement costs milliseconds.
- **`verify` — executed proof.** Runs the declared validation commands (config `validation.commands`, the `## Commands` block of `plan.md`, or `package.json` scripts), captures their exit codes verbatim into `.coding-flow/runs/*-verify.json`, and fails if one breaks or none ran. Declare `validation.quality` (lint, format-check, `jscpd`) and it runs in the same pass. Each proof binds to a content token of the working tree and a toolchain fingerprint, so a green run that no longer matches the code reads as `stale` until re-verified.
- **`run` — one report over many stories.** `ai-flow run` (all stories, one `--epic`, or one `--story`) verifies each story for real, writes its per-story proof, and emits one aggregated `*-run.json` report. It orchestrates; an executor *driver* runs the work — today only `none` (verify what's already implemented), with agent drivers a reserved, pluggable seam. Afterward `status` reflects the fresh proof.
- **`audit` / `trace` / `ship` / `ci`.** `audit` aggregates proofs into an append-only ledger (`--export` writes `docs/AUDIT.md`, `--check` is the "no merge without a green verify" gate); `trace` walks story → commits → PR → evidence → tests; `ship` injects the latest proof into the PR body; `ci init` scaffolds a clean-room workflow replaying the per-story `run` (or `verify`) + `audit --check`.

**What the proof does and does not claim.** `verify` executes your declared commands and captures their real exit codes, so the agent **cannot lie about having run them or about the result** — a green story means the machine ran the checks and they passed. It does **not** prove the *code is correct*: the agent writes both the code and the tests, so a weak suite proves only that weak tests pass. The value is removing the "did you actually check?" trust gap, not certifying correctness.

**Where this actually pays off.** If you supervise every run and press Enter on `npm test` yourself, you don't need captured proof — be honest about that. The proof earns its keep the moment you are *not* in the loop: a batch `ai-flow run` that verifies several stories and hands you one proof report, a CI gate that decides without you watching, or a teammate reviewing a PR who wasn't there when it ran. In those cases "the agent said the tests passed" is worth nothing and an executed, provenance-stamped result is worth everything.

We are validating this claim honestly with a small vanilla-vs-coding-flow benchmark on five escalating tasks — methodology and (pending) numbers in [`docs/experiments/reliability-benchmark.md`](docs/experiments/reliability-benchmark.md).

## Working Day To Day

**Story status** — `ai-flow status` (add `--json`) lists epics/stories and their state, backed by executed proof, not prose: an explicit `## Status` override wins, otherwise the latest `verify` (green → `verified`, red → `blocked`, code changed since → `stale`), and only then a fallback heuristic. So `verified` means the machine actually ran the validation and it passed.

**Parallel work (worktrees)** — *optional* support to develop genuinely independent features in parallel, each in its own Git worktree, without any runtime dependency:

```bash
ai-flow worktree add feat/payments        # worktree + branch, wires .env / deps
ai-flow worktree add --story epics/epic-03-kyc/story-03-01-kyc-upload
ai-flow worktree list
ai-flow worktree remove feat/payments     # removes the worktree, keeps the branch
```

Worktrees are placed as **siblings** (`../<repo>-worktrees/<name>`), not inside the repo, so tools like `tsc`/eslint/jest and `git clean -fdx` can't reach them. With `--story`, the worktree↔story mapping is stateless (resolved by branch name). Worktree concepts and trade-offs: [`docs/git-worktree-bare.md`](docs/git-worktree-bare.md).

**One PR per feature** — from a worktree or any feature branch, `ship` pushes and opens **one** idempotent PR against the base (via `gh` if available):

```bash
ai-flow ship                       # push + PR to the default branch
ai-flow ship --base develop --draft
ai-flow ship --dry-run
```

## Context & Story Files

| File | Holds |
| --- | --- |
| `docs/project-context.md` | Durable map of the project's current state (domains, data model, roles, constraints, risks, roadmap). **Not** implementation logs or a raw codebase audit. |
| `docs/architecture.md` | Boundaries, modules, data flow, architecture conventions, important dependencies. |
| `docs/conventions.md` | Code, test, UI, API, naming, file, and validation conventions. |
| `docs/roadmap.md` | Next product steps and milestones. |
| Story `spec.md` | What the story delivers and its acceptance criteria. |
| Story `plan.md` | How: approach, decisions and tradeoffs, the `## Commands` validation block, and the test plan. |
| Story `tasks.md` | The checklist plus `## Result` — what actually happened: files changed, tests run, rollback notes, follow-ups, remaining risks. |

## Stop Conditions

Stop and report instead of guessing when: the scope is ambiguous; acceptance criteria are not testable; the auth/role/permission model is unclear; a breaking migration is needed; an external service, secret, or API contract is unknown; the validation commands cannot run; the existing architecture contradicts the request; security depends on a client-side-only control; or the edit point stays unclear after the context budget. When one triggers, the agent explains what is blocking, why continuing is risky, what is missing, and which skill to use next.

## CLI Commands

| Command | Use |
| --- | --- |
| `ai-flow init` | Install the templates, config (`.coding-flow/config.json`), and harness policy. `--force` reinstalls, `--dry-run` previews, `--no-guard` skips the hook. |
| `ai-flow upgrade` | Update installed files without overwriting local changes. |
| `ai-flow doctor` | Check files, skills, frontmatter, manifest. `--fix` restores missing files, `--strict` adds checks. |
| `ai-flow status` | List epics/stories, inferred status, and the linked worktree. |
| `ai-flow run [--epic\|--story <path>]` | Verify a batch of stories and emit one aggregated proof report. `--driver` is a reserved executor seam (only `none` today); `--dry-run` shows the plan. |
| `ai-flow bootstrap --scan` | Scan an existing codebase into `docs/bootstrap-scan.md`. |
| `ai-flow harness preflight\|check\|verify\|evidence --story <path>` | Estimate risk / scan secrets / run + capture validation / write evidence. |
| `ai-flow guard` | PreToolUse hook: refuses (exit 2) writing a blocked path or secret, before the disk. |
| `ai-flow audit [--export\|--check]` | Aggregate the append-only ledger; export `docs/AUDIT.md`; CI gate on the latest verify. |
| `ai-flow trace [--story <path>]` | Story → commits → PR → evidence → tests chain, with missing links. |
| `ai-flow ci init` | Scaffold a clean-room GitHub Actions workflow (per-story `run` or `verify`, then `audit --check`). |
| `ai-flow hook install\|uninstall\|status` | Opt-in local pre-push gate running `audit --check`. |
| `ai-flow worktree add\|list\|remove` | Optional Git worktrees for parallel work. |
| `ai-flow ship` | Push the current branch and open/update one PR against the base. |
| `ai-flow list-skills` / `commands` / `version` | Show skills / the useful project commands / the CLI version. |

After `init`, shorter local scripts are available: `npm run flow:doctor`, `flow:check`, `flow:skills`, `flow:status`, `flow:harness`, `flow:commands`, `flow:upgrade`, `flow:fix`, `flow:uninstall`. All accept `-- --json` for CI.

## Uninstall

```bash
npx @landry_pouth/coding-flow uninstall            # --dry-run to preview, --force to remove local-edited files
```

It removes the files Coding Flow installed (rules, `docs/`, `.claude/skills/`, `.coding-flow/`, matching `flow:*` scripts) but **always keeps** `epics/` and everything generated inside them. Locally modified files are kept by default.

## Documentation

- **[docs/QUICKSTART.md](docs/QUICKSTART.md)** — the whole loop on one screen.
- **[docs/migration.md](docs/migration.md)** — upgrade an existing project safely.
- **[docs/contributing.md](docs/contributing.md)** — CLI architecture, distribution channels, publishing, and the full internal-docs index (for contributors).
