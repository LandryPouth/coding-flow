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
