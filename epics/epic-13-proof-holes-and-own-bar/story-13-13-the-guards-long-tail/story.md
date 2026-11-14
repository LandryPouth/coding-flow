# Story 13-13 — The guard's long tail

## Status: in-progress

Left open on purpose by story 13-09 after five review rounds (2026-11-14):
13-09 closed every plainly written copy, move, link, extract, patch and
`git restore`/`checkout` form that could land a blocked path, under the rule
*refused when known, else unchecked — never a silent allow*. These forms
still exit 0 without a log line, or log `unchecked` where an ordinary
command should pass.

*(STRICT — the write guard is the security core.)*

## Acceptance Criteria

- [x] Git plumbing that writes the work tree is judged: `git checkout-index`
      (`-a`, `-f`, named paths), `git update-index` followed by a checkout,
      `git clone` / `git worktree add` into a blocked path, `git read-tree -u`.
- [x] `scp` and `sftp` into a blocked path are refused; `busybox <applet>`
      is read as the applet it names.
- [x] `unrar x`, `jar xf`, `pax -r` into a blocked path are refused, else
      logged `unchecked`.
- [x] Process or command substitution anywhere on a copy's command line
      (`--exclude-from=<(…)` before the source) makes the copy `unchecked`,
      whatever its position (if 13-09 did not already close it).
- [x] An extraction inside the project whose members can be listed without
      running anything (`tar -tf`, `unzip -l` on a file on disk) is judged by
      its members instead of being logged `unchecked`, so strict mode no
      longer refuses an ordinary `tar -xzf vendor.tgz`.
- [x] Every new form has a test from the adversarial corpus
      (`test/guard-adversarial.test.js`); existing tests stay unmodified.
      CHANGELOG `[Unreleased]` → Security; DOGFOODING row updated.

## Out of Scope

- Aliases, shell functions, `eval` of built strings, `IFS` games: a
  stateless hook cannot model them; they stay documented limits.

## Result

`bin/lib/shell-writes.js` reads git plumbing (`checkout-index`, `read-tree -u`,
`clone`, `worktree add`), `scp`/`sftp`, `busybox` applets and `unrar`/`jar`/`pax`
extractions; `bin/lib/archive-members.js` lists a tar, gzip tar or zip on disk
so `bin/lib/guard.js` judges an in-project or ancestor extraction by its members.
Tests: `test/guard-long-tail.test.js` (8, red first). Decisions in `plan.md`.

### Rollback Notes

Revert the story's commits; no data or config migrates.
