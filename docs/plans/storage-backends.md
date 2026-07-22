# Storage seam, project config, and branch policy

This document describes three related additions to `ai-flow`:

1. a **storage seam** (epics/stories go through a pluggable backend);
2. a **project config** `.coding-flow/config.json` that records the decisions;
3. a **policy** "one epic = one branch, never on main".

## Why a seam, and why not (yet) the GitHub backend

The triggering idea: store epics/stories as **GitHub issues / sub-issues**
instead of local directories, for teams that live in GitHub. The choice is made
at install time, **only one backend active at a time** (local **or** github),
never both — no two-way sync, no ambiguous source of truth.

But building the GitHub backend **now** would be a premature investment:

- it makes `gh` + network **mandatory** on every `status`/`harness`/story read
  (today offline and instantaneous);
- it loses the properties that make the tool valuable: the story **in the diff**
  of the PR, `grep`, versioning the spec alongside the commit that implements it;
- sub-issues go through `gh api graphql` (no first-class command), hence fragile
  code to maintain forever;
- the project has no users yet: we would pay the cost on a hypothetical need,
  not an observed one.

**Decision: we lay the seam now (near-zero cost), we defer the GitHub backend**
until a real user asks for it. When the time comes, it plugs into
`bin/lib/storage/github.js` without rewriting the rest of the tool.

## Architecture

| File | Role |
| --- | --- |
| `bin/lib/config.js` | Reads/writes `.coding-flow/config.json` (defaults, validation, migration) |
| `bin/lib/storage/index.js` | `getStorage(cwd)`: picks the backend from the config |
| `bin/lib/storage/local.js` | Local backend (`epics/` directories), default — the only thing that knows the story layout |
| `bin/lib/storage/github.js` | GitHub backend: **seam in place, clear `fail()`, implementation deferred** |
| `bin/lib/policy.js` | Evaluates the `branchPerEpic` policy (pure git read, never blocking) |

A backend's interface is minimal and deliberately extensible:

```js
storage.listEpics() // -> [{ name, path, stories: [{ name, title, status, path }] }]
```

`status.js` consumes the backend for the story content; the **worktree link** and
the **policy** remain the git layer, orthogonal to storage.

## Project config — `.coding-flow/config.json`

```json
{
  "version": 1,
  "storage": "local",
  "branchPerEpic": true
}
```

- Written by `init` (honors `--storage` and `--no-branch-per-epic`).
- `upgrade` **creates it if absent** (migration of projects installed before the
  seam) without ever overwriting an existing choice.
- JSON, not YAML: the project stays zero-dependency.
- A corrupt config or an unknown `storage` value falls back cleanly to the
  defaults.

`init --storage github` is **refused** today (clear message, no config written):
we don't allow a choice that would break `status`. If we force `storage:
"github"` by hand, `status` fails cleanly — the seam is proven, nothing crashes.

## Policy "one epic = one branch, never main"

`branchPerEpic` (default `true`) is a **recorded decision**, not a hard-coded
wall: `status` surfaces it (warning when on the base branch), it does not block a
repo that legitimately commits on main. Same spirit as the `ship` guardrail.
Can be disabled via `init --no-branch-per-epic`.

In JSON, `status` exposes:

```json
"policy": { "branchPerEpic": true, "branch": "main", "onBase": true }
```

## Tests

`test/config-storage.test.js` (8 tests, real CLI in temp directories):

- `init` writes the config (storage local, branchPerEpic true);
- `--no-branch-per-epic` disables the policy;
- `--storage github` is refused and **writes no config**;
- `--storage <unknown>` is refused;
- `status --json` exposes `storage` and `policy`;
- `storage: "github"` fails `status` cleanly (seam proven);
- on the base branch, `status` flags the policy (`onBase: true` + text);
- `upgrade` creates the config for a project installed before the seam.

## What is deliberately out of scope

- **The GitHub backend itself**: epic↔issue / story↔sub-issue mapping via
  `gh api graphql`, to be done when a real need exists.
- **Any local↔github sync**: excluded by design (only one active backend).
