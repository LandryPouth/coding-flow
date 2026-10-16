# Story 10-03 — Tasks

- [x] Matrix + git setup step.
- [x] Run, triage: product bug fixed / POSIX-only test skipped with reason.
- [x] Skip list recorded here; README platform line.
- [x] CHANGELOG.

## Status: in progress (Windows autoland removal still being verified in CI)

## Skipped on Windows (each carries its reason in the test file)

POSIX `/bin/sh` fake binaries (`test/codex-probe.test.js`, `test/doctor-opencode-major.test.js`):
- a codex that is found but fails or hangs on --version is inconclusive, not "absent"
- doctor/init: a denied probe is confirmed-working (x3); a write that is NOT denied (x2)
- doctor: codex failing for its own reasons; a glob-only policy; doctor twice on an unchanged project
- report shows the probe outcome next to the tier it earned
- opencode 2.x host: plugin before the 2.x entry; every --version format; global plugin; version on stderr; exit non-zero

The wired Claude hook is a POSIX `sh` command (`test/guard.test.js`, `test/self-install-paths.test.js`):
- the wired hook runs the resolved binary directly; init upgrades an npx-based hook; upgrade re-points the hook
- the Claude hook for this checkout uses $CLAUDE_PROJECT_DIR

No executable bit on Windows (`test/hook.test.js`): install creates an executable pre-push hook.
Symlink creation needs Developer Mode (`test/worktree-plan.test.js`): a project root reached through a symlink.

## Product bugs found by the runners

- Worktree path comparisons failed through a symlinked (macOS) or 8.3-short (Windows) project root — fixed (`canonicalPath`/`samePath` in `bin/lib/util.js`).
- `autoland` removed the worktree it was running in; Windows cannot delete the current directory — fixed (chdir out, brief retry).
