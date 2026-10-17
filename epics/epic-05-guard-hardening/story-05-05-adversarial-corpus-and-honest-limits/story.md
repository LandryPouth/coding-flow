# Story 05-05 — Adversarial corpus and honest limits

Every case from the 2026-10-16 measurement (`docs/plans/hardening-roadmap.md`)
lives in one table-driven test file, with its expected decision, so a
regression in any of them is one failing row with a readable name. The README
lists, in one short section, what the guard still does not see.

*(QUICK — a test file and a README section; no runtime change.)*

## Acceptance Criteria

- [ ] `test/guard-adversarial.test.js` holds a table `[name, setup, hook,
      expected]` covering at least: direct write, `../`, symlink (Write and
      Bash), `ln -s` alias, `cd ../`, subshell `cd`, `~/.ssh`, worktree
      primary `.env`, monorepo subdirectory, `git checkout --`, `python -c`,
      `node -e` concatenation (expected: allow — documented limit), variable
      target (unchecked), `bash script.sh` (allow — documented limit), unknown
      write tool (unchecked), unparseable input (unchecked), tee/cp/mv/`sed
      -i`/`dd`, secret in content, secret in command.
- [ ] Each "documented limit" row links (comment) to the README section, so
      changing it requires changing the docs.
- [ ] README: a "What the guard does not see" section (≤ 15 lines): scripts
      and compiled programs, computed paths, network downloads, TOCTOU, writes
      by the tools the validation commands run; and the advice: use
      `mode: strict` plus OS-level isolation (container, devcontainer, a
      sandboxed agent mode) when the boundary must hold.
- [ ] `npm test` green.

## Handed over from 05-01

Limits 05-01's reviews found and left here, each to become a corpus row (deny,
or a documented limit):

- `mkdir d && cp|mv KEY d` — a directory made earlier in the same command.
- Case-insensitive mounts on Linux (WSL `/mnt/c`): the platform default misjudges them.
- Roots come from the session `cwd`: under a custom root-anchored outer policy,
  a nested project's `pkg/.env` is allowed from the outer project, denied from `pkg/`.
- A nested git repo without `.coding-flow/` gets the default policy, which can
  re-impose a refusal the owner lifted (from inside that repo only).
- A `$HOME` that is a git repo (dotfiles) bounds the `.coding-flow/` search at `~`.

## Status: planned
