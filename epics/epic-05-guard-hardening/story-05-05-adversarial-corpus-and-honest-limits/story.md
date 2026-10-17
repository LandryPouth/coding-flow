# Story 05-05 — Adversarial corpus and honest limits

Every case from the 2026-10-16 measurement (`docs/plans/hardening-roadmap.md`)
lives in one table-driven test file, with its expected decision, so a
regression in any of them is one failing row with a readable name. The README
lists, in one short section, what the guard still does not see.

*(QUICK — a test file and a README section; no runtime change.)*

## Acceptance Criteria

- [x] `test/guard-adversarial.test.js` holds a table `[name, setup, hook,
      expected]` covering at least: direct write, `../`, symlink (Write and
      Bash), `ln -s` alias, `cd ../`, subshell `cd`, `~/.ssh`, worktree
      primary `.env`, monorepo subdirectory, `git checkout --`, `python -c`,
      `node -e` concatenation (expected: allow — documented limit), variable
      target (unchecked), `bash script.sh` (allow — documented limit), unknown
      write tool (unchecked), unparseable input (unchecked), tee/cp/mv/`sed
      -i`/`dd`, secret in content, secret in command.
- [x] Each "documented limit" row links (comment) to the README section, so
      changing it requires changing the docs.
- [x] README: a "What the guard does not see" section (≤ 15 lines): scripts
      and compiled programs, computed paths, network downloads, TOCTOU, writes
      by the tools the validation commands run; and the advice: use
      `mode: strict` plus OS-level isolation (container, devcontainer, a
      sandboxed agent mode) when the boundary must hold.
- [x] `npm test` green.

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

## Handed over from 05-04

- The guard reads `mode` from its roots only (outermost and nearest
  `.coding-flow/`, the repo top): a strict `.coding-flow/` *between* them is
  skipped by the hook and the in-process guard, while the OpenCode plugin's
  fallback (`isStrict`) honours it. A corpus row, or `strictOutcome` reads every
  `.coding-flow/` up to the outermost one.

## Status: done

## Result

`test/guard-adversarial.test.js`: 37 rows `[name, setup, hook, expected, limit?]`
run through `evaluate()` in a fresh git repo each, plus one test that reads the
README section. A row's optional fifth element is the README phrase that
documents it; the last test fails when the README stops saying it (checked by
removing one phrase: red, restored: green). Every expected decision was observed
before it was written down; none of the measured holes is still open except the
documented limits.

Every handed-over limit is a row: `mkdir d && cp .env d` (allow), `.ENV` on a
case-sensitive platform (allow on Linux, deny on macOS/Windows), the root-anchored
outer policy (allow from outside `pkg/`, deny from inside), the nested git repo
without `.coding-flow/` (deny), the git `$HOME` (`~/.coding-flow/` governs a project
under it), and 05-04's intermediate strict `.coding-flow/` (unchecked, not refused).

README: the "What the guard does not see" section (14 lines), and the two older
sentences that still called `python -c` out of reach (05-03 refuses it when the
code names a protected path) now point to it. The symlink rows skip on Windows,
like `guard-unchecked.test.js`.

The first two verifies went red on `test/worktree-autoland.test.js` (the flake in
`docs/DOGFOODING.md`, 2026-10-17), made more frequent by this file's load. Root
cause, captured: under load this WSL2 clock steps back ~2.5 s every ~30 s, and
"latest verify" is chosen by `generatedAt`, so a fixture written before a step
outranked the real re-verify written after it. The auto-land fixtures are now
stamped from a fixed past clock (stamping them 5 s ahead reproduces both failing
tests on demand); verify `2026-10-17T16-37-48-295Z` is green.
