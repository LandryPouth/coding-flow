# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/), and the project adheres to
[Semantic Versioning](https://semver.org/).

## [0.4.0] - 2026-07-31

A consolidation release: the same evidence spine, a much smaller surface. Three
renames make the tool easier to hold in your head. Breaking — see
[`docs/migration.md`](docs/migration.md) (`upgrade` adds the new files but never
deletes the old ones, so a 0.3 project keeps working alongside residue to clean
by hand with `trash`).

### Added

- **`ai-flow run`** — batch story orchestrator: resolves stories (all / `--epic` /
  `--story`), verifies each for real, writes per-story proof plus one aggregated
  `-run.json` rollup, and exits non-zero if any verifiable story failed. Ships the
  `none` driver (verify already-done work); agent execution is a reserved
  `--driver` seam that fails cleanly until wired.

### Changed

- **Rules merged into one file.** `PROJECT_RULES.md` + `AGENT_RULES.md` → a single
  **`RULES.md`** (imported by `CLAUDE.md`).
- **Stories collapsed from six files to three:** **`spec.md`** (what & acceptance),
  **`plan.md`** (how + decisions + `## Commands` + test plan), **`tasks.md`**
  (checklist + `## Result` + rollback).
- **Skills collapsed from ~30 to six:** `setup`, `plan`, `run`, `verify`, `review`,
  `ship`. Depth (STRICT mode, deep validators, the context scout, TDD) is now
  opt-in *sections* inside `/run` and `/review`, not separate skills.
- **CI gate** now replays `run` (per-story verify) or repo-wide `harness verify`,
  then `audit --check`, on a clean checkout — pinned to the published version.

## [0.3.0] - 2026-07-28

Coding Flow is now explicitly a **Claude Code** tool. Support for Codex and other
agents is planned through per-agent targeting, but is not shipped yet.

### Removed

- **The legacy `.agents/` shared skill mirror.** The neutral physical copy of the
  skills (meant for Codex and non-Claude agents) is gone: it was a source of
  confusion and is superseded by the planned per-agent targeting
  (`docs/plans/multi-agent-install.md`). `init`/`upgrade` no longer create
  `.agents/`, and `doctor` no longer requires or checks it. Existing projects keep
  working — `uninstall` still removes any `.agents/` entries recorded in their
  manifest, and a leftover `.agents/` directory is simply ignored.

### Changed

- Repositioned as a Claude Code-first tool: package description, keywords, README
  intro, and the marketplace description now state Claude Code explicitly, with
  Codex flagged as planned.

## [0.2.0] - 2026-07-28

The release that turns Coding Flow from an *AI methodology* into an **evidence &
governance layer** — every advisory guardrail becomes an *executed* one, attached
to a human identity, aggregated into an exportable ledger, and verified out of the
agent's hands. Distributed as a native Claude Code plugin and published on npm.

### Added

- **Guard hook** — deterministic `PreToolUse` hook that enforces the harness
  policy (blocks secrets and writes to protected paths, exit 2). Inactive until
  published; now live via `npx --yes @landry_pouth/coding-flow guard`.
- **Harness `verify`** — actually executes the project's declared validation
  commands and captures verbatim exit codes/output into `.coding-flow/runs/`.
  "Nothing executed" fails as "not verified".
- **Identity** — every evidence run is attached to a resolved human identity, so
  the ledger is auditable rather than anonymous.
- **Audit ledger** — append-only evidence ledger with `audit --export` and a CI
  gate.
- **Trace** — end-to-end chain: story → commits → PR → evidence → tests.
- **Ship** — attaches the latest `verify` evidence to the PR body.
- **Clean-room CI** — GitHub Actions gate that re-runs `verify` + `audit` out of
  the agent's hands.
- **Native plugin packaging** — `.claude-plugin/` manifest + marketplace, so the
  skills and guard hook install via `/plugin marketplace add LandryPouth/coding-flow`.
- **Storage seam + project config** — pluggable epic/story backend, `.coding-flow/config.json`,
  and a `branchPerEpic` policy (local backend; GitHub backend deferred by design).
- **Parallel mode** — `ai-flow worktree add/list/remove` for developing several
  features in parallel without leaving the zero-dependency stance.
- **Test & CI harness** — behavioral `node:test` suite on throwaway git repos,
  GitHub Actions on Node 18/20/22, and a `pre-push` hook.

### Changed

- Repository language translated from French to English for better AI adherence.
- Skill invocation syntax switched from `$skill` to `/skill`.
- Published to npm as `@landry_pouth/coding-flow` (public).

### Notes

- **Zero runtime dependencies** — everything relies on `node:*` built-ins; `git`
  and `gh` stay optional shell-outs with clean degradation.
- The GitHub storage backend (issues/sub-issues) is a proven seam with a clean
  `fail()`; implementation stays deferred until a real need appears.

[0.4.0]: https://github.com/LandryPouth/coding-flow/releases/tag/v0.4.0
[0.2.0]: https://github.com/LandryPouth/coding-flow/releases/tag/v0.2.0
