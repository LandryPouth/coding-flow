# Story 30-03 — Coverage and scan are judged per repository

## User Value

The checks that keep a green suite honest — "behaviour changed but no test
changed", line coverage of added lines, and `ai-flow scan` — look at each
repository's own diff and reports. A web change with no web test is caught
even when the API side of the same story added plenty of tests.

## Requirements

- **Test-change rule** (`coverage-gate.js`, README "Coverage gate"): evaluated
  per repository on that repository's diff from its base. One repository
  failing it → `NOT PROVEN` naming that repository; `## Test Exemption` may
  name a repository (`web: <reason>`) or apply to all.
- **Coverage reports**: `repos.<name>.coverageReports` (globs) resolved inside
  that repository (or its worktree); freshness per report as today; a changed
  file in a repository with no report is *unmeasured*, per repository.
- **Scan** (29-01): run per repository on its added lines; findings carry the
  repository name (`web/src/a.ts:6 …`). If 29-01 has not shipped, this part is
  skipped and the story's Result says so.
- **Evidence**: `repos.<name>.coverage` and `repos.<name>.scan`.

## Acceptance Criteria

- [ ] Given a story naming `api, web` where `web` changed a source file and no test while `api` changed both, when verify runs on a risky diff, then the verdict is NOT PROVEN and the signal names `web`.
- [ ] Given `## Test Exemption` with `web: copy-only change`, when verify runs, then the verdict is not lowered and the reason is copied into `repos.web` evidence.
- [ ] Given `repos.api.coverageReports: ["coverage/lcov.info"]` written fresh in the api worktree, when verify runs, then added api lines are measured and `repos.api.coverage` holds the percentage.
- [ ] Given a stale report in `web` only, when verify runs, then only `web` is reported stale.
- [ ] Given an added `it.only(` in `web` (29-01 shipped), when verify runs, then the finding is listed as `web/<file>:<line> test.only`.
- [ ] Given no `repos`, the existing coverage and scan suites are unchanged and green.

## Edge Cases

- Lockfile-only or docs-only diff in one repository: that repository never
  trips the rule (today's exemption, per repository).
- Report `SF:` paths relative to a package inside the repository (bethl
  epic 09): resolved against the package root inside that repository.
