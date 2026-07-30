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
| [`migration.md`](migration.md) | Migrating an existing project to a new version: `upgrade` vs re-install, what is protected, and the gotchas |
| [`sdd-vs-plugins.md`](sdd-vs-plugins.md) | From the old SDD to a plugin + governance layer: what changed and why |
| [`git-worktree-bare.md`](git-worktree-bare.md) | Git worktree & bare: concept, sharing `node_modules`/`.env`, when not to use it |
| [`plans/parallel-mode.md`](plans/parallel-mode.md) | Parallel mode (`worktree`), story link, `ship` |
| [`plans/storage-backends.md`](plans/storage-backends.md) | Storage seam, project config, branch policy |
| [`plans/evidence-governance.md`](plans/evidence-governance.md) | Evidence & governance layer: guard, provenance, audit, trace, CI, plugin |
| [`plans/testability.md`](plans/testability.md) | Production-grade testability: `verify`, negative proof, anti-slop |
| [`plans/testing-and-ci.md`](plans/testing-and-ci.md) | The package's test suite and CI |
| [`plans/code-quality.md`](plans/code-quality.md) | Code quality & DRY: deterministic-vs-judgment split, the 3 tiers |
| [`plans/status-and-check-enforcement.md`](plans/status-and-check-enforcement.md) | Evidence-backed story status and machine-enforced checks |
| [`plans/evidence-hardening.md`](plans/evidence-hardening.md) | Evidence freshness (anti-stale), reproducibility fingerprint, pre-push gate |
| [`plans/reliability-repositioning.md`](plans/reliability-repositioning.md) | Repositioning to "reliability", npm-over-github, surface reduction, STRICT merge |
| [`plans/reliability-framing-honesty.md`](plans/reliability-framing-honesty.md) | Honest-framing pass: naming, opt-in ceremony, evidence pitch, guard-first |
| [`experiments/reliability-benchmark.md`](experiments/reliability-benchmark.md) | The (in-progress) benchmark validating the reliability claim |

## Roadmap

- `ai-flow add-epic`, `ai-flow add-story`
- better merge with existing docs
- stricter doctor checks for cross-references between skills
- optional support for a stricter status format in the story files
