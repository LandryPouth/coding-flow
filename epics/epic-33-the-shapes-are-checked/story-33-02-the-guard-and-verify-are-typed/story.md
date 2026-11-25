# Story 33-02 — The guard and verify are typed

Extends 33-01's check to the two hottest modules: the guard's decision path
and verify's run path.

## Acceptance Criteria

- [ ] Given `bin/lib/guard.js`, `bin/lib/hook.js`, `bin/lib/validation-run.js`
      and `bin/lib/run.js` with `// @ts-check`, when `npm run typecheck` runs,
      then it exits 0.
- [ ] Given the guard's decision type (`allow`/`deny`/`ask` with a reason), then
      every return of the decision path is checked against it.
- [ ] Given the guard's latency measured before and after (cold CLI and
      in-process), then neither changed by more than noise (types are comments).
- [ ] Any real error found is fixed with a test that fails before the fix and
      listed in the Result; the guard's frozen 29-03 side is not edited.
- [ ] The Result records epic 32's red-verify rate at this point against the
      2026-11-25 baseline, as the first reading of whether typing pays.

## Commands

```bash
npm test
npm run typecheck
```

## Status: planned

## Result
