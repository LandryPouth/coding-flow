# Story 04-03 — Tasks

- [ ] Read `scoreDiffRisk`/`defaultHighRiskPaths`/`matchesPattern`
      (`harness.js`) (targeted discovery — extend, do not restructure).
- [ ] Add a structural-signal pass to `scoreDiffRisk` (unconditional
      `git worktree remove`/`git branch -D`/unattended merge), with unit
      tests including a false-positive guard on an already-`allowFail`-guarded
      call.
- [ ] Write `scripts/check-lock-exit-reachability.js` (dependency-free),
      scoped to this project's `withFileLock`/`fail()` convention.
- [ ] Add a regression fixture reproducing `landCleanup`'s pre-fix shape;
      confirm the check fails red on it and passes clean on the current,
      fixed `worktree.js`.
- [ ] Declare the script in `.coding-flow/config.json`'s
      `validation.quality`.
- [ ] Update `docs/DOGFOODING.md`'s 2026-08-28 row `Resolution`.
- [ ] Run `npm test`; capture the verify.

## Status: planned

## Result

### Rollback Notes

