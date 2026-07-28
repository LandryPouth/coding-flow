# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/), and the project adheres to
[Semantic Versioning](https://semver.org/).

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

[0.2.0]: https://github.com/LandryPouth/coding-flow/releases/tag/v0.2.0
