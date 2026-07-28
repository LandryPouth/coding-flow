# Tests, CI, and Pre-Push Hook

This document describes the reliability harness added to the `ai-flow` CLI:
automated tests, continuous integration, and a local Git hook. It serves as a
reference for understanding what now protects the users' repos against a
regression in the commands that write to disk.

## Context

The CLI (`bin/ai-flow.js`, ~2400 lines) modifies the target project's files:
`init`, `upgrade`, `uninstall`, and `doctor --fix` create, update, or delete
files. Before these additions, there were **no tests** and **no CI**. A bug in
`upgrade` or `uninstall` could therefore damage a user's repo without a safety
net.

The design constraint stayed the same as the rest of the project: **zero
dependencies**. Everything relies on tools built into Node (>= 18) and Git.

## What Was Added

| File | Role |
| --- | --- |
| `test/cli.test.js` | 10 CLI contract tests, via the `node:test` runner. |
| `package.json` (`test` script) | `npm test` runs `node --test`. |
| `.github/workflows/test.yml` | CI: runs `npm test` on push to `main` and on PRs, Node 18/20/22. |
| `.githooks/pre-push` | Git hook: runs `npm test` before every push, blocks on failure. |

The `test/` directory is not in the `files` field of `package.json`, so it is
**not shipped** in the package distributed via `npx`. The tests protect
development without bloating the user-side install.

## Tests

The tests are behavioral: they run the real CLI in a temporary directory and
verify the observable behavior (files written, exit code), not the internal
details. That is what actually protects the commands' contract.

Current coverage:

- `init` installs the expected structure and creates a private `package.json`;
- `init --dry-run` writes no file;
- `doctor` succeeds on a healthy install and fails if a required file is
  missing;
- `doctor --fix` restores a missing file;
- `upgrade` is idempotent and **preserves local edits**;
- `init --force` reinstalls over local edits;
- `uninstall` removes the managed files but **keeps `epics/`**;
- `list-skills` lists the available skills.

Run the suite:

```bash
npm test
```

## GitHub Actions CI

The `.github/workflows/test.yml` workflow runs `npm test`:

- on every `push` to `main`;
- on every pull request;
- across the Node `18.x`, `20.x`, `22.x` matrix.

No dependency-install step is needed (zero-dep CLI).

This CI matters because distribution happens via
`npx github:LandryPouth/coding-flow`: users pull `main` directly. A broken push
would break the tool for everyone. The CI is the net that prevents that.

> **Go-live status**: the CI only activates once the workflow is **pushed to
> GitHub**. As long as the files are not committed and pushed, it does not exist
> on the server side.

## Pre-Push Hook

`.githooks/pre-push` runs `npm test` before every push and **cancels the push**
if a test fails. It is the local net, complementary to the CI.

The hook is versioned (`.githooks/` directory) so it can be shared with the team,
but Git does not activate this directory automatically. Each clone must activate
it **once**:

```bash
git config core.hooksPath .githooks
```

To push urgently while skipping the tests:

```bash
git push --no-verify
```

## Enabling It For A New Clone

After cloning the repo, a contributor enables the local hook with:

```bash
git config core.hooksPath .githooks
```

The CI, for its part, requires no activation: it runs as soon as the workflow is
present on GitHub.

## Checks Performed

| Check | Result |
| --- | --- |
| Full test suite | 10/10 pass |
| Hook when the tests pass | exit 0, push allowed |
| Hook when a test fails | exit 1, push blocked |
| CI YAML | valid, Node 18/20/22 matrix |

## Possible Next Steps

- Add a CI status badge to `README.md`.
- Extend coverage to the `bootstrap` and `harness` commands.
- Introduce tags/releases to allow pinning a stable version
  (`npx github:LandryPouth/coding-flow#vX.Y.Z`) rather than pulling `main`.
