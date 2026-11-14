# Story 18-07 — Worktrees are a setting

## Status: planned

Design decision 17 (2026-11-14): the worktree layer becomes optional. The
study's rule — *if the friction persists once epics 02/03 are stable, make
the layer optional rather than extend it* — was met by story 15-06's count
(`docs/plans/uncle-bob-gauntlet.md`, *Re-measured 2026-11-14*). The maintainer
keeps worktrees on for themselves; other users may not need them.

*(STANDARD — a setting read in several commands and skills; no gate changes.
Runs after 18-02: a land must already carry the story's proof.)*

## Acceptance Criteria

- [ ] A `worktrees` setting with values `on` / `off` is read from the user's
      machine settings (the same place as the agent-process setting, epic
      24), overridable per project in `.coding-flow/config.json`; the
      project value wins. `ai-flow doctor` prints the value in effect and
      where it came from.
- [ ] With `off`: `/flow-run` and `ai-flow next` run a story in the current
      checkout on a story branch (no `worktree add`), `status` shows no
      worktree column noise, and `land` merges that branch locally — no
      command requires a worktree. A second chain run in parallel still gets
      one, and says why.
- [ ] With `on`: behaviour is today's, byte for byte (the existing worktree
      tests stay green, unmodified).
- [ ] The default for a new install is stated in the decision entry and in
      `docs/` — the maintainer's lean is `off` for others ("maybe not for
      others") — and this repository and the maintainer's machine run with
      `on`.
- [ ] CHANGELOG `[Unreleased]` → Changed; skills edited under
      `templates/.claude/skills/` with their eval cases.

## Out of Scope

- Carrying proof at land (story 18-02, a prerequisite).
- Removing the worktree commands: they stay, for parallel chains and for
  users who keep them on.
