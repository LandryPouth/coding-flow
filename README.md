# Coding Flow

[![npm](https://img.shields.io/npm/v/@landry_pouth/coding-flow?logo=npm)](https://www.npmjs.com/package/@landry_pouth/coding-flow)
[![CI](https://github.com/LandryPouth/coding-flow/actions/workflows/test.yml/badge.svg)](https://github.com/LandryPouth/coding-flow/actions/workflows/test.yml)
[![license](https://img.shields.io/npm/l/@landry_pouth/coding-flow)](LICENSE)

**Evidence-based guardrails around AI coding agents.** Coding Flow checks that agent-generated changes are safe, tested, and reviewable *before* they ship: it runs your tests itself and shows `verified` only when they **actually** passed — not when the agent says they did.

Your CI already tells you whether the repository is green. Coding Flow answers the narrower question — *is **this change** proven?* — and answers it before the secret is written, not after the push.

> **Claude Code first.** Coding Flow currently targets Claude Code — the skills, the plugin, and the `guard` hook are wired for it. Support for Codex and other agents is planned (see [`docs/plans/multi-agent-install.md`](docs/plans/multi-agent-install.md)), but not shipped yet.

**What you get over plain Claude Code + a good `CLAUDE.md`:** the `guard` hook refuses to write a `.env`, a key, or a secret **before it reaches the disk** — through the editing tools *and* through the common shell write forms (`> .env`, `tee`, `sed -i`, `cp`), so the obvious leak paths are closed rather than merely discouraged (what it does not read: writes performed inside an interpreter, e.g. `python -c`) — plus executed proof instead of the agent's word, fewer forgotten files, and less context burned per change. When you want it, the same executed proof doubles as an audit/evidence layer for teams that need governance. That machinery runs *for* you underneath a tiny front door; you rarely type it yourself.

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
3. **The skills** — a small, flat set of reusable workflows, one per stage: `/flow-setup`, `/flow-plan`, `/flow-run`, `/flow-review`, `/flow-ship` — plus two read-only lookups you can reach for any time, `/flow-status` and `/flow-next`. They are **structured prompts Claude Code reads and follows** — depth (STRICT mode, deep validators, context scout) lives as opt-in sections inside `/flow-run` and `/flow-review`, not as separate skills. There is no orchestration at runtime. **A skill guides; it never guarantees.** A skill that says "run the tests before finishing" can be forgotten, misread, or interrupted — only the CLI can say `NOT PROVEN` and mean it. Skills are agent-specific guidance and are **not** part of the enforcement guarantees; they change more freely than the CLI does.
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

A small, flat set. You pick any of them directly; there is no macro/atomic hierarchy to chain by hand.

| Skill | Use |
| --- | --- |
| `/flow-setup` | Scaffold Coding Flow into the current repo from Claude Code (once per repo). |
| `/flow-plan` | Turn an objective into a vertical epic and implementation-ready stories. Includes opt-in sections for clarifying fuzzy requirements and bootstrapping a brownfield codebase. |
| `/flow-run` | Execute one story end-to-end. Picks QUICK/FAST/STANDARD/STRICT by risk; STRICT adds security validation. Context scout and TDD are inline modes. |
| `/flow-review` | Findings-first pre-merge review. Each dimension (architecture, tests, security, quality, E2E) has an opt-in deep section for high-risk work. |
| `/flow-ship` | Commit a dirty tree, push the branch, and open/update one PR, with the latest verify evidence attached. |

The five above follow the workflow stage by stage. Two more are read-only lookups,
not tied to any stage — reach for them any time, in parallel with everything else:

| Skill | Use |
| --- | --- |
| `/flow-status` | Where every epic and story actually stands — proof-derived state, worktree links, branch policy. |
| `/flow-next` | The one command worth running right now, ranked from that same state. |

The depth that used to live in separate `agent-*` and `*-check` skills — the deep
validators, the multi-agent worker roles, the context scout, TDD — is **not gone**;
it moved into opt-in sections of `/flow-run` and `/flow-review`, so nothing capable was lost
while the front door shrank from thirty skills to seven.

**Why no `verify` skill?** Because verification is not a decision you make — it is
something the machine owes you. `/flow-run` runs it on every story, `ai-flow status`
and CI read its result, and `ship` attaches it to the PR. You never have to ask for
it. When you do want it on demand — re-proving a story that went `stale` after a
one-line edit — that is `ai-flow verify --story <path>` in the terminal, not a slash
command. A skill is a verb you need; verify is a fact you need to trust.

## The Reliability Layer

The harness turns *advisory* guardrails into *executed* ones, attached to an identity and verified out of the agent's hands. It does **not** sandbox the agent, intercept every shell command, replace your tests/lint/reviews, or guarantee an app is secure — it catches obvious mistakes and leaves usable proof.

- **`guard` — deterministic enforcement.** A PreToolUse hook refuses writing a `.env`, a key, or content containing a secret **before** it reaches the disk (exit 2). It watches both doors: the editing tools (`Write`/`Edit`/`MultiEdit`/`NotebookEdit`) and `Bash` — redirections and heredocs (`> .env`), `tee`, `sed -i`, `cp`/`mv`/`ln`/`install`, `dd of=`. It parses shell text, not program semantics, so a write buried in `python -c` is out of reach and the after-the-fact `harness check` stays the net for it. Wired into `.claude/settings.json` by `init`; also travels with the plugin. It runs the package's own binary, resolved locally at install — no `npx` in the write path, so enforcement costs milliseconds.
  - **Detectors are the project's, not ours.** `harness.json` carries the patterns in full, so you can read, edit, extend, or delete them. Each is `exact` (a real credential *format* — Stripe, AWS, GitHub, a private-key block) or `heuristic` (a *shape*, like `password: "…"`). Only heuristics are relaxed by `secretScanAllowlist`, which covers docs, story files, tests, and fixtures by default — so an example in your documentation is allowed while an AWS key in that same file is still refused. A pattern you write wrong is reported by `harness check` instead of silently scanning nothing.
- **`verify` — executed proof.** Runs the declared validation commands (config `validation.commands`, the `## Commands` block of `plan.md`, or `package.json` scripts), captures their exit codes verbatim into `.coding-flow/runs/*-verify.json`, and fails if one breaks or none ran. Declare `validation.quality` (lint, format-check, `jscpd`) and it runs in the same pass. Each proof binds to a content token of the working tree and a toolchain fingerprint, so a green run that no longer matches the code reads as `stale` until re-verified.
  - **Coverage gate — a green suite is not a covered change.** On risky work, `verify` also reads the branch's diff: if behavior changed and no test file did, it reports `NOT PROVEN` (exit 1) instead of `verified`, because a suite that was already green before the edit proves nothing about it. Narrow on purpose — low-risk work, docs/story/lockfile-only diffs, and repos where the diff cannot be read never trip it. A change that genuinely cannot carry a test declares a `## Test Exemption` section in its story, or `--test-exemption "<reason>"`; the reason is copied verbatim into the evidence and the PR body, so the escape hatch leaves a mark. Off with `requireTestChange: false`.
  - **It names how strong the proof is.** "A test file changed" and "92% of the added lines ran" are not the same claim, so they are not printed in the same voice. Every verdict lands on a named rung — `verified` (the added lines were measured and enough of them executed), `evidence` (a test file moved, nothing measured it), `exempted` (a human wrote down why), `not-required`, `missing` — and the rung travels into the evidence JSON, the PR body, and the `run` report. `evidence` also says how to earn `verified`: emit a coverage report (`lcov.info`, `coverage-final.json`) from the suite this run executes.
  - **It never asks for coverage a suite cannot give.** `nonBehaviorGlobs` excludes what no test can execute — type declarations (`*.d.ts`), build/tool config, SQL and migrations, generated code — so those still raise the risk level and appear in the evidence, but are not asked to prove a unit test ran over them. A gate that fires on a case the developer cannot legitimately fix is a gate they learn to switch off.
  - **Risk comes from the diff, not only from the prose.** Story text is written by the agent, so a risk score read only from that text is a score the agent controls — describe an auth change as "update the login page" and every gate keyed on risk quietly stands down. So the paths in `highRiskPaths` (auth, migrations, schemas, payments, secrets, webhooks) raise the risk on their own, and the higher of the two sources wins. Two consequences: wording a story mildly no longer lowers the bar, and the gate works on a branch with **no story at all** — so the proof layer is usable without adopting the `epics/` layout.
- **Reads your spec format, not only ours.** A [Spec Kit](https://github.com/github/spec-kit) feature directory already holds `spec.md` / `plan.md` / `tasks.md` — the same three roles a story has — so `verify` treats it as one. In a project with a `.specify/` directory, `ai-flow verify` with no `--story` scopes itself to the active feature, resolved the way Spec Kit resolves it (`SPECIFY_FEATURE_DIRECTORY`, then `.specify/feature.json`, then the branch name), and says which source it used. Risk is scored from the spec, commands still come from config or `package.json`, and no `epics/` directory is created. Nothing is imported from Spec Kit and it does not need to be installed — if the directories are there, they can be read. The point is not to define how you write specs; it is that however you define the work, the execution can be checked.
- **`run` — one report over many stories.** `ai-flow run` (all stories, one `--epic`, or one `--story`) verifies each story for real, writes its per-story proof, and emits one aggregated `*-run.json` report. It orchestrates; an executor *driver* runs the work — today only `none` (verify what's already implemented), with agent drivers a reserved, pluggable seam. Afterward `status` reflects the fresh proof.
- **`audit` / `trace` / `ship` / `ci`.** `audit` aggregates proofs into an append-only ledger (`--export` writes `docs/AUDIT.md`, `--check` is the "no merge without a green verify" gate); `audit --decisions` is a separate, read-only mode — a cross-epic view of every story's recorded `## Decisions`, `--export` writing `docs/DECISIONS.md` (generated, never hand-maintained); `trace` walks story → commits → PR → evidence → tests; `ship` injects the latest proof into the PR body; `ci init` scaffolds a clean-room workflow replaying the per-story `run` (or `verify`) + `audit --check`.

**What the proof does and does not claim.** `verify` executes your declared commands and captures their real exit codes, so the agent **cannot lie about having run them or about the result** — a green story means the machine ran the checks and they passed. The coverage gate adds the next link: on a risky story, a green run that added no test is not accepted as proof, so "verified" can no longer mean "rode along on a suite that was already passing." It still does **not** prove the *code is correct*: the agent writes both the code and the tests, so a weak suite proves only that weak tests pass, and the agent still chooses which commands `plan.md` declares. The value is removing the "did you actually check?" trust gap and forcing the change to be covered — not certifying correctness.

**Where this actually pays off.** If you supervise every run and press Enter on `npm test` yourself, you don't need captured proof — be honest about that. The proof earns its keep the moment you are *not* in the loop: a batch `ai-flow run` that verifies several stories and hands you one proof report, a CI gate that decides without you watching, or a teammate reviewing a PR who wasn't there when it ran. In those cases "the agent said the tests passed" is worth nothing and an executed, provenance-stamped result is worth everything.

We are validating this claim honestly with a small vanilla-vs-coding-flow benchmark on five escalating tasks — methodology and (pending) numbers in [`docs/experiments/reliability-benchmark.md`](docs/experiments/reliability-benchmark.md).

## Working Day To Day

**Story status** — `ai-flow status` (add `--json`), or `/flow-status` without leaving Claude Code, lists epics/stories and their state, backed by executed proof, not prose: an explicit `## Status` override wins, otherwise the latest `verify` (green → `verified`, red → `blocked`, code changed since → `stale`), and only then a fallback heuristic. So `verified` means the machine actually ran the validation and it passed.

**What to do next** — `status` describes state, `ai-flow next` (or `/flow-next`) decides: it ranks that same state (blocked stories first, then a "done" claim with no captured verify behind it, then stale proof, then a proven story with unshipped work, then a planned story with no worktree yet) and prints the one command worth running right now (`--all` for the whole ranked queue). It is read-only and scoped to the checkout it runs from — with several worktrees open in parallel, each terminal's `next` answers for *that* worktree, not a global view across all of them.

**Parallel work (worktrees)** — *optional* support to develop genuinely independent features in parallel, each in its own Git worktree, without any runtime dependency:

```bash
ai-flow worktree add feat/payments        # worktree + branch, wires .env / deps
ai-flow worktree add --story epics/epic-03-kyc/story-03-01-kyc-upload
ai-flow worktree list
ai-flow worktree remove feat/payments     # removes the worktree, keeps the branch
```

Worktrees are placed as **siblings** (`../<repo>-worktrees/<name>`), not inside the repo, so tools like `tsc`/eslint/jest and `git clean -fdx` can't reach them. With `--story`, the worktree↔story mapping is stateless (resolved by branch name). Worktree concepts and trade-offs: [`docs/git-worktree-bare.md`](docs/git-worktree-bare.md).

**One PR per feature** — from a worktree or any feature branch, `ship` commits any
dirty tree (behind the same secret scan as `harness check --quick`), pushes, and
opens **one** idempotent PR against the base (via `gh` if available):

```bash
ai-flow ship                       # commit + push + PR to the default branch
ai-flow ship --base develop --draft
ai-flow ship --no-commit           # push existing commits only, old behavior
ai-flow ship --dry-run
```

**Auto-merge** — off by default (`autoMergeEpic: false` in `.coding-flow/config.json`).
When on, `ship` merges its PR itself via GitHub's native auto-merge, but only once
every story in the current branch's epic has an actual captured green verify (a
written `## Status: done` alone does not count — see Auto-Merge in the `/flow-ship`
skill), and never on a draft PR or one that conflicts with the base:

```bash
ai-flow ship --auto-merge                          # force-enable for this run
ai-flow ship --auto-merge --merge-method squash
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

The bare `ai-flow` form below resolves only if it is installed globally
(`npm install -g @landry_pouth/coding-flow`); `init` itself never installs
anything system-wide. Without a global install, run these via
`npx @landry_pouth/coding-flow <command>` instead. `init`, `upgrade`, and
`doctor` each print a `PATH:` line telling you which form works on the
current machine.

| Command | Use |
| --- | --- |
| `ai-flow init` | Install the templates, config (`.coding-flow/config.json`), and harness policy. `--force` reinstalls, `--dry-run` previews, `--no-guard` skips the hook. |
| `ai-flow upgrade` | Update installed files without overwriting local changes. |
| `ai-flow doctor` | Check files, skills, frontmatter, manifest. `--fix` restores missing files, `--strict` adds checks. |
| `ai-flow status` | List epics/stories, inferred status, and the linked worktree. |
| `ai-flow next` | Rank that state and print the one command worth running now (`--all` for the whole queue). |
| `ai-flow run [--epic\|--story <path>]` | Verify a batch of stories and emit one aggregated proof report. `--driver` is a reserved executor seam (only `none` today); `--dry-run` shows the plan. |
| `ai-flow bootstrap --scan` | Scan an existing codebase into `docs/bootstrap-scan.md`. |
| `ai-flow harness preflight\|check\|verify\|evidence --story <path>` | Estimate risk / scan secrets / run + capture validation / write evidence. |
| `ai-flow guard` | PreToolUse hook: refuses (exit 2) writing a blocked path or secret, before the disk. |
| `ai-flow audit [--export\|--check\|--decisions]` | Aggregate the append-only ledger; export `docs/AUDIT.md`; CI gate on the latest verify; `--decisions` is the cross-epic `## Decisions` view instead (`--export` → `docs/DECISIONS.md`). |
| `ai-flow trace [--story <path>]` | Story → commits → PR → evidence → tests chain, with missing links. |
| `ai-flow ci init` | Scaffold a clean-room GitHub Actions workflow (per-story `run` or `verify`, then `audit --check`). |
| `ai-flow hook install\|uninstall\|status` | Opt-in local pre-push gate running `audit --check`. |
| `ai-flow worktree add\|list\|remove` | Optional Git worktrees for parallel work. |
| `ai-flow ship` | Commit a dirty tree, push, and open/update one PR against the base; can auto-merge when the epic is done (opt-in). |
| `ai-flow list-skills` / `commands` / `version` | Show skills / the useful project commands / the CLI version. |

After `init`, shorter local scripts are available: `npm run flow:doctor`, `flow:check`, `flow:skills`, `flow:status`, `flow:next`, `flow:harness`, `flow:commands`, `flow:upgrade`, `flow:fix`, `flow:uninstall`. All accept `-- --json` for CI.

## Uninstall

```bash
npx @landry_pouth/coding-flow uninstall            # --dry-run to preview, --force to remove local-edited files
```

It removes the files Coding Flow installed (rules, `docs/`, `.claude/skills/`, `.coding-flow/`, matching `flow:*` scripts) but **always keeps** `epics/` and everything generated inside them. Locally modified files are kept by default.

## Documentation

- **[docs/QUICKSTART.md](docs/QUICKSTART.md)** — the whole loop on one screen.
- **[docs/migration.md](docs/migration.md)** — upgrade an existing project safely.
- **[docs/agent-contract.md](docs/agent-contract.md)** — what Coding Flow expects from an agent, agent-neutral: the protocol every integration translates.
- **[docs/DOGFOODING.md](docs/DOGFOODING.md)** — the friction log: where the tool cost more than it returned, and what was done about it. `init` installs a blank one into your project too, and the `RULES.md` it writes tells the agent to add a row as the friction happens — above all when a check gets disabled or exempted to keep moving.
- **[docs/contributing.md](docs/contributing.md)** — CLI architecture, distribution channels, publishing, and the full internal-docs index (for contributors).
