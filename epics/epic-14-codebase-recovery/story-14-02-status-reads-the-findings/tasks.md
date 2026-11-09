# Story 14-02 — Tasks

- [x] Parser + tests on fixture dossiers.
- [x] status section and JSON; next ranking; doctor warning.
- [x] SKILL.md: assess/fix write `Fixed by:` after a green verify.
- [x] `npm test`; verify; CHANGELOG (Added).

## Result

### Verification

- `env -u OPENCODE -u OPENCODE_PID -u CLAUDE_CODE_SSE_PORT npm test` — full
  suite passes (1,233 tests).
- `node scripts/check-function-size.js` — the touched functions do not grow;
  `buildStatusModel`, `status`, `buildQueue` and `collectDoctorReport` keep
  their measured length.
- `ai-flow verify --story epics/epic-14-codebase-recovery/story-14-02-status-reads-the-findings`
  — passed: 4 commands, green coverage of the added lines.

### Rollback Notes

Revert the commit. `status`, `next` and `doctor` are read-only; no project file
is written, so there is no user data to clean up.

### Review fixes (2026-11-09)

`/flow-review` failed the story with two P1s, both fixed with a test that fails
on the previous code:

- the local dossier was read from `.coding-flow/recovery/findings.md` instead of
  `findings.local.md` — the test helper wrote the same wrong name;
- `Fixed by: ../../docs/x-verify.json` reached a file outside the guarded
  `.coding-flow/runs/` and forged "fixed (proven)". The name must now be a bare
  `-verify.json` file name, and a run named by two findings proves neither
  (one finding per fix branch, as the skill already requires).

Also: `path:line-line` and `path:line:column` locations resolve, a `### R…`
heading without an `R-NN` id is listed as unreadable, and the section header
names the file(s) read. Tying a run to *which* finding it fixes stays with
red-at-base (14-03).
