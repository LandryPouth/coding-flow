# Story 09-01 — Read every package's coverage report

## User Value

A monorepo that already produces coverage gets `verified` instead of the
`evidence` proxy, and a package without a report is not mistaken for
"untested".

## Requirements

- `coverageReports` entries may be globs (`apps/*/coverage/lcov.info`,
  `packages/*/coverage/coverage-final.json`). When the key is absent and the
  root `package.json` has `workspaces` or `pnpm-workspace.yaml` exists, the
  defaults also include `*/*/coverage/lcov.info` and
  `*/*/coverage/coverage-final.json`.
- **All** matching, fresh (written after the run started — existing rule),
  parseable reports are loaded, not only the first.
- Each report's paths resolve against its **package root**: the nearest
  ancestor directory of the report holding a `package.json` (fallback: the
  report's parent of `coverage/`). Absolute `SF:` paths keep today's handling.
- Merged per file (max hits per line when two reports cover the same file).
- A changed behaviour file is *measured* when it lies inside a loaded
  report's package root; otherwise it is *unmeasured*. Patch coverage is
  computed over measured files; unmeasured behaviour files fall back to the
  test-file rule for their package; the run's rung is the weakest of the two.
- Evidence: `coverage.patch.report.reports: [{ path, format, package, files }]`,
  `coverage.patch.unmeasured: [files]` (nested under `patch`, beside `uncovered`).

## Acceptance Criteria

- [x] Two packages, each with a fresh lcov using package-relative `SF:`, a
      diff touching both, all added lines executed → `verified`, two reports
      listed.
- [x] Same, but one package's added line not executed → coverage below the
      threshold names that file with its repo-relative path.
- [x] Reports for `apps/api` only, diff touches `apps/web/x.tsx` and a web
      test file → rung `evidence`, `unmeasured` lists `apps/web/x.tsx`; the
      file is **not** reported as uncovered.
- [x] A stale report (mtime before the run) in one package is ignored, the
      other is used.
- [x] Root-level single report (today's case) behaves exactly as before.

## Edge Cases

- Istanbul JSON keys are absolute paths: resolve as today.
- Two reports claiming the same file with different line maps (Jest + Vitest
  on a shared package): merge by max hits, and record both report paths.

## Status: done

## Result

bethl read-only check (2026-10-17, a throwaway clone of `feature/EPIC-32-geo`
under the scratchpad; bethl itself untouched, `node_modules` symlinked):

- **Workspace defaults, no `coverageReports`.** `pnpm-workspace.yaml` adds
  `*/*/coverage/*`; the existing `apps/api/coverage/lcov.info` (Jest, `SF:` relative
  to `apps/api`) loads as package `apps/api`, 106 files resolved to
  `apps/api/src/…` (9 missing on disk: files deleted since that May report).
- **A foreign report is refused, not mis-read.** `apps/web/coverage/coverage-final.json`
  holds absolute paths under the repo's old location (`…/saas/imob/…`): every key is
  outside the root, so the report contributes nothing.
- **A fresh run.** Validation command `cd apps/api && npx jest --coverage
  --testPathIgnorePatterns openapi-contract` (that suite fails on its own: stale
  `openapi.json`), plus a new `isAppWeekend` in `src/common/app-time.ts` tested on
  Saturday only. Verify read the fresh report (213 files, `package: apps/api`) and
  reported exactly `apps/api/src/common/app-time.ts` line 68 (`return false`) as not
  executed — Jest's own lcov says `DA:68,0`. Rung: `missing` (NOT PROVEN, 75.2 % of
  693 added lines against `develop`): the epic diff carries prisma scripts absent from
  the report and an unmeasured `apps/web` (no fresh web report), which is the gate
  doing its job, not a resolution error.

### Rollback Notes

Revert the two commits; no schema or config migration.
