# Epic 09 — Monorepo proof: measured coverage and honest command results

## Goal

In a pnpm/turbo monorepo, a verify can reach `verified` (line coverage of the
added lines, across packages), says when a test result was a cache replay,
and does not kill a legitimate long suite at a fixed 10 minutes.

## Why

Measured on bethl (`docs/plans/hardening-roadmap.md`):

- **0 of 341 runs measured line coverage.** `coverage.js`
  `DEFAULT_REPORT_PATHS` are root-relative (`coverage/lcov.info`…); bethl
  writes `apps/api/coverage/lcov.info` (Jest) and Vitest reports per package.
  `loadCoverageReport` returns the **first** report found — one package at
  most — and resolves `SF:` paths against the repo root, while Jest writes
  them relative to the package (`SF:src/app.module.ts`).
- **Cache replay is invisible.** 132 of 318 `npm run test` results were full
  turbo replays (`Cached: N cached, N total`, median 5.9 s). The developer
  then forced `--force` everywhere: median 183 s, max 773 s, plus 55 s of
  lint — on every verify. A replay is not wrong (turbo hashes inputs), but the
  evidence should say it, and the choice to force should be targeted.
- **Two timeouts (exit 124)** against the fixed `timeoutMs = 600000`
  (`runValidationCommand`, `harness.js` ~1374).

## Scope

**In scope**

- Several coverage reports, globbed, merged, each resolved against its own
  package root; per-report freshness (already enforced for one report).
- Per-command result field `cache: "full" | "partial" | "none" | "unknown"`
  for turbo and nx output; verify output and evidence show it; an opt-in
  floor that does not accept a full replay as fresh proof in strict.
- Configurable timeout per command / globally.

**Out of scope — decisions made while planning**

- **Running coverage for the user.** coding-flow reads reports the project
  produces; adding `--coverage` to the user's commands is their config
  (documented in the README with a turbo example).
- **Parsing every test runner's cache.** turbo and nx only; anything else is
  `unknown`.

## Backbone

`Backbone: validation commands run (with coverage on, as configured) → every fresh report under the configured globs is read and mapped to repo paths → patch coverage measured across packages → each command result carries its cache state → evidence and output show "verified, 3 reports" and "tests: replayed from cache"`

### Story dependency tree

```text
s1
s2
s3
```

Three independent stories.

## Stories

1. **story-09-01-read-every-package-coverage-report** — globs, merge,
   package-relative `SF:`. *(STRICT — it can upgrade a verdict to
   `verified`; a wrong mapping would claim coverage that was not measured)*
2. **story-09-02-record-cache-replays** — turbo/nx detection, evidence field,
   strict option. *(STANDARD)*
3. **story-09-03-configurable-command-timeout** — `validation.timeoutMs` and
   per-command override. *(QUICK)*

## Decisions

- **Unmeasured files stay unmeasured.** With reports for `apps/api` only, a
  changed `apps/web` file is not "uncovered": it is outside every report's
  package, so the rung for the run is the weakest of the parts (`evidence`
  if web has a test-file change). Never extrapolate one package's coverage
  to another.
