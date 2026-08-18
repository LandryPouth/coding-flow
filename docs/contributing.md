# Contributing & Internals

Everything a contributor needs that a user does not. For daily use, see the
[README](../README.md) and [QUICKSTART](QUICKSTART.md).

## Local development

```bash
gh repo clone LandryPouth/coding-flow
cd coding-flow
npm install
npm link            # makes the short `ai-flow` command global
npm test            # the full behavioural suite (also run by prepublishOnly)
```

Run the CLI straight from the repo without linking:

```bash
node bin/ai-flow.js init --dry-run
node bin/ai-flow.js list-skills
```

`doctor` inspects an install in a *target* project, so test it against a throwaway directory:

```bash
mkdir /tmp/coding-flow-test && cd /tmp/coding-flow-test
node /path/to/coding-flow/bin/ai-flow.js init --force
node /path/to/coding-flow/bin/ai-flow.js doctor
node /path/to/coding-flow/bin/ai-flow.js status
```

## CLI architecture (`bin/`)

`bin/ai-flow.js` is a thin dispatcher: it parses arguments and delegates to cohesive
modules in `bin/lib/`. **No runtime dependencies.**

| Module | Responsibility |
| --- | --- |
| `lib/context.js` | Shared constants (root, templates, cwd, npm scripts) |
| `lib/util.js` | Generic helpers (I/O, hash, JSON, paths, glob, file walking) |
| `lib/config.js` | Project config `.coding-flow/config.json` (storage, branchPerEpic, autoMergeEpic, validation) |
| `lib/templates.js` | Installation, manifest, scripts, cheat-sheet, `upgrade` |
| `lib/harness.js` | Security, scan of secrets/sensitive files, preflight/check/`verify`/evidence |
| `lib/identity.js` | Git provenance (commit, branch, author, dirty, PR) injected into every proof |
| `lib/guard.js` | Deterministic PreToolUse hook (refusal of blocked paths / secrets before write) |
| `lib/settings.js` | Idempotent merge/upgrade of the `guard` hook into `.claude/settings.json` (resolved binary, npx fallback) |
| `lib/audit.js` | Append-only ledger, `docs/AUDIT.md` export, `--check` gate, `--decisions` cross-epic ADR view (`docs/DECISIONS.md` export) |
| `lib/trace.js` | Story → commits → PR → evidence → tests chain |
| `lib/ci.js` | Scaffolder of the clean-room CI workflow (`verify` + `audit`) |
| `lib/plugin.js` | Native plugin channel: sync/check of the skills vs templates |
| `lib/storage/` | Storage seam: `local` (default) and `github` (deferred) |
| `lib/policy.js` | "One epic = one branch, never main" policy |
| `lib/doctor.js` | Diagnostic + `--fix` |
| `lib/skills.js` | `list-skills` |
| `lib/claude-plugin.js` | Best-effort detection of an installed coding-flow plugin (decides the `init` default for the skills channel) |
| `lib/status.js` | State of the epics/stories (via the seam) + worktrees + policy |
| `lib/next.js` | `next`: ranks that same state (proof, not labels) into the one command worth running now |
| `lib/bootstrap.js` | Brownfield scan |
| `lib/uninstall.js` | Uninstall preserving `epics/` |
| `lib/worktree.js` | Optional Git worktrees (parallel work) |
| `lib/ship.js` | `ship`: push of the current branch + one PR, with the `verify` proof attached |
| `lib/commands.js` | `help` and `commands` |

The dependency graph is acyclic:
`context → util → config → harness → templates → {doctor, uninstall, skills, commands}`;
`status` builds on `config`/`storage`/`policy`/`worktree`.

## The two distribution channels

- **npm package** (`@landry_pouth/coding-flow`) — powers the CLI and CI. Fetched
  automatically by `npx` the first time it runs; users never install it by hand.
- **Native Claude Code plugin** — delivers the skills and the `guard` hook globally,
  updated through the marketplace.

The plugin's `skills/` are materialized from `templates/.claude/skills/` by
`ai-flow plugin sync` and kept drift-free by `ai-flow plugin check` (enforced in
tests/CI). **Any skill add/remove/rename must happen in both trees.**

A project must never receive the skills from both channels at once — that is two
names for the same skill. `lib/claude-plugin.js` detects an installed plugin and
`init` copies the project files only when there is none; the answer is recorded
in `.coding-flow/config.json` (`skills: "plugin" | "project"`) so `doctor`,
`upgrade`, and `uninstall` all judge the project against the same decision rather
than re-detecting per machine. `getTemplateSpecs({ includeSkills })` in
`lib/templates.js` is the single seam every one of them derives that view from.

Skills are named `flow-*` because Claude Code ships built-in `run` and `review`
skills. Never reintroduce a bare, generic skill name.

```bash
npx @landry_pouth/coding-flow init      # official install, no clone needed
npx github:LandryPouth/coding-flow init # unreleased main; slower, no version pin
```

## Publishing

The package is publish-ready: scoped name `@landry_pouth/coding-flow`,
`publishConfig.access = public`, and a `prepublishOnly` guardrail that runs the test
suite before any publication.

```bash
npm login       # once, on the @landry_pouth account
npm test        # must be green (also run by prepublishOnly)
npm publish     # publishes @landry_pouth/coding-flow@<version>
```

> The bare name `coding-flow` is taken by a third party on npm; the `@landry_pouth/*`
> scope guarantees a free, collision-free name.

## Internal documentation

| Doc | Subject |
| --- | --- |
| [`QUICKSTART.md`](QUICKSTART.md) | The whole loop on one screen: the front door you use day to day |
| [`agent-contract.md`](agent-contract.md) | What Coding Flow expects from an agent, agent-neutral — the protocol each integration translates |
| [`design-decisions.md`](design-decisions.md) | What was decided and what was refused, with the measurements — read before re-proposing a guard daemon, a Go rewrite, or policy in skill frontmatter |
| [`DOGFOODING.md`](DOGFOODING.md) | The friction log: where the tool cost more than it returned, and what came of it |
| [`migration.md`](migration.md) | Migrating an existing project to a new version: `upgrade` vs re-install, what is protected, and the gotchas |
| [`sdd-vs-plugins.md`](sdd-vs-plugins.md) | From the old SDD to a plugin + governance layer: what changed and why |
| [`git-worktree-bare.md`](git-worktree-bare.md) | Git worktree & bare: concept, sharing `node_modules`/`.env`, when not to use it |
| [`plans/multi-agent-install.md`](plans/multi-agent-install.md) | Per-agent install targeting, plus a verified capability table: what Claude Code, Codex and OpenCode can each actually enforce |
| [`plans/storage-backends.md`](plans/storage-backends.md) | Storage seam, project config, branch policy (github backend deferred) |
| [`experiments/reliability-benchmark.md`](experiments/reliability-benchmark.md) | The (in-progress) benchmark validating the reliability claim |

## What belongs in the core

The failure mode for a tool like this one is not a missing feature. It is
becoming a large, admired, fragile framework nobody trusts with a `--force`.
Six checks that always hold their word beat twenty-five that mostly do.

So every proposed feature answers one question first:

> **If I don't implement it, does Coding Flow fail at its mission?**

The mission is guardrails and evidence for AI coding agents. `verify`, the
`guard` hook, the risk score, and the coverage gate all fail that question
without them — a longitudinal report of past runs does not, however useful it
would be. That is the difference between the core and a good idea.

Two rules that follow from it:

- **Prefer an adapter, a config key, or an external integration over a new core
  subsystem.** [`bin/lib/speckit.js`](../bin/lib/speckit.js) is the shape to
  copy: ~160 lines, nothing imported from Spec Kit, Spec Kit need not be
  installed, and deleting the file removes a capability without breaking one.
- **Do not abstract before the second real case.** `measurePatchCoverage(...)`
  ships as a function. It becomes an interface the day a second implementation
  actually exists, not the day one is imagined.

The project is currently in a **feature freeze**: bugs, DX, performance,
security, documentation, and tests only. New capabilities wait for real users to
ask for them.

## Writing a skill

Skills are structured prompts, and their length is a bill the user pays on every
trigger. Two rules, both enforced by `test/ceremony.test.js`:

- **A `SKILL.md` stays under 500 lines.** Past that, move the opt-in depth (a deep
  review dimension, a mode that rarely fires) into a sibling file the skill links
  to, so it loads only when it is needed. Link one level deep — from `SKILL.md`
  straight to the file, never through an intermediate.
- **Both trees change together.** `skills/` is what the Claude Code plugin serves;
  `templates/.claude/skills/` is what `ai-flow init` copies into a project. They
  are byte-identical, and a test fails if they drift.

Prefer extracting the prose you already have over adding more. A "Common
Rationalizations" table earns its lines because it answers an excuse at the moment
the agent reaches for it; a second explanation of something stated above does not.

## Roadmap

- `ai-flow add-epic`, `ai-flow add-story`
- better merge with existing docs
- stricter doctor checks for cross-references between skills
- optional support for a stricter status format in the story files
