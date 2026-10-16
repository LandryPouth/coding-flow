# Story 10-02 — Tasks

- [x] Unattended detection; refusal; `--allow-plan-commands`.
- [x] `--clean-env`.
- [x] Evidence fields; skill line + `plugin sync` + eval case if routing text changes.
- [x] Tests; `npm test`; verify; CHANGELOG.

## Status: done

## Result

- `verify` refuses plan.md commands when unattended (no TTY, `CI=true`, `worktree land`) unless `--allow-plan-commands`; in a terminal it announces them and runs. Evidence records `unattended`, and `refused` when nothing ran.
- `--clean-env` drops credential-named variables (names recorded, never values).
- Verify green (`Coverage: evidence`). Red→green shown by disabling the refusal: the two refusal tests fail.
- Deviation from the spec: `NODE_*`/`npm_*` are kept only if their names do not look like credentials (`NODE_AUTH_TOKEN` is dropped); only `PATH`, `HOME`, `CI` are kept unconditionally.
- `ai-flow run` uses the default detection (a human in a terminal may run it). Existing tests that exercise plan.md commands now force a TTY through `AI_FLOW_FORCE_TTY=1` (test-only, honoured under `NODE_ENV=test` alone).
- Unrelated flaky tests seen in the full suite (patch-coverage, command-timeout, upgrade --no-skills): they fail differently on each run.

## Review notes

- A refused verify is not recorded as evidence (it executed nothing, and would overwrite
  a green proof); `run` reports such a story as skipped. `--clean-env` bypasses the cache.
- `CI` counts as unattended for any value but empty/`0`/`false`, and wins over
  `AI_FLOW_FORCE_TTY` (test-only, honoured under `NODE_ENV=test` alone).
- `NODE_AUTH_TOKEN`-style names are dropped by `--clean-env` even under `NODE_*`.
- `worktree land` re-verifies with no story directory, so it never resolves plan.md
  commands today; `unattended: true` there is a guard for when it does, not observable
  in a test.
