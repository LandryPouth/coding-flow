# Story 05-01 — Plan

## Implementation Context

- **Execution mode**: STRICT.
- **Likely files**:
  - `bin/lib/guard.js` — `toRelative` (~233) becomes `resolveTargets(root,
    target)` returning `[{ label, relative, base }]` for lexical/real and the
    outside-root bases; `decide` (~238) and `decideBash` (~298) iterate over
    them; `guardCommand` (~396) and `evaluate` (~438) resolve the project root
    before calling `decide`.
  - `bin/lib/worktree.js` — `ENV_FILES` (~112) is the reason the worktree
    case exists; no change there.
  - `test/guard.test.js` — new cases using real symlinks and a real
    `git worktree add` in `mktemp -d`.
- **Search anchors**: `toRelative`, `blockedPathHit`, `matchesPattern`,
  `isAllowedEnvExample`.
- **Areas to avoid**: `matchesPattern`/glob semantics — reuse as is; only the
  input paths change.

## Technical Notes

- Nearest existing ancestor: walk `path.dirname` until `fs.existsSync`, then
  `realpathSync(ancestor)` + `path.join(rest)`.
- Primary checkout: `git -C <root> rev-parse --path-format=absolute
  --git-common-dir` → `dirname` when it differs from `<root>/.git`.
- `isAllowedEnvExample` must still apply after resolution (`.env.example`
  through a link stays allowed).

## Decisions

- Reason text keeps the existing sentence shape so `denials.jsonl` readers and
  `report` need no change; it only adds `(via <lexical>)` when lexical and real
  differ.
- Without `-T`, an `ln` destination is read both as the link's name and as a
  directory the link lands in, since a `mkdir` earlier in the same command can
  make it one. A link meant as `x/y` that resolves outside the project from `x`
  but inside it from `x/y` (`ln -s ../../.env x/y`) is therefore denied: the
  over-deny is the price of not reading the shell's future, and `-T` lifts it.
- A target is judged against every root the SESSION answers to — found from the
  hook `cwd`, not from the target: the outermost `.coding-flow/` (governing: logs,
  reason), the nearest `.coding-flow/`, the nearest git toplevel — each with its
  own policy, and denied on any hit. Policy patterns are root-anchored (`.env`),
  so one root cannot stand in for another; a nested policy can only add refusals
  (including `mode: "strict"`), never lift the outer one's. A nested root's secret
  allowlist judges only targets inside it.
- Consequences kept, handed to 05-05: from the outer project, a nested project's
  `pkg/.env` is judged by the outer policy only (allowed if that policy is a
  custom root-anchored `.env` without `**/.env*`), while from inside `pkg/` it is
  denied. A nested git repo with no `.coding-flow/` gets the default policy, which
  can re-impose a refusal the owner lifted, from inside it only. A `$HOME` that is
  itself a git repo bounds the `.coding-flow/` search at `~`.
