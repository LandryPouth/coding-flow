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
- Evidence: `coverage.reports: [{ path, format, package, files }]`,
  `coverage.unmeasured: [files]`.

## Acceptance Criteria

- [ ] Two packages, each with a fresh lcov using package-relative `SF:`, a
      diff touching both, all added lines executed → `verified`, two reports
      listed.
- [ ] Same, but one package's added line not executed → coverage below the
      threshold names that file with its repo-relative path.
- [ ] Reports for `apps/api` only, diff touches `apps/web/x.tsx` and a web
      test file → rung `evidence`, `unmeasured` lists `apps/web/x.tsx`; the
      file is **not** reported as uncovered.
- [ ] A stale report (mtime before the run) in one package is ignored, the
      other is used.
- [ ] Root-level single report (today's case) behaves exactly as before.

## Edge Cases

- Istanbul JSON keys are absolute paths: resolve as today.
- Two reports claiming the same file with different line maps (Jest + Vitest
  on a shared package): merge by max hits, and record both report paths.
