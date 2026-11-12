# Story 19-03 — Plan

## Implementation Context

- **Execution mode**: STANDARD.
- **Likely files**: `bin/lib/placement-store.js` (`withFileLock`,
  `LOCK_STALE_MS` — reuse the lock primitive), `bin/lib/harness.js` (verify
  entry), `bin/lib/harness-config.js` (new keys), `bin/lib/verify-queue.js`
  (new), `test/verify-queue.test.js` (new).
- **Search anchors**: `withFileLock`, `LOCK_WAIT_TIMEOUT_MS`,
  `harness.json`, `toolError`.
- **Scout pre-step**: no.
- **Areas to avoid**: the guard (must stay lock-free and fast).

## Technical Notes

- bethl bilan P1: "une file à l'échelle de la machine : un seul verify lourd à
  la fois tous checkouts confondus, démarrage conditionné à la mémoire libre".
- The test suite itself runs verify in temp repos: the re-entrant marker keeps
  `npm test` from deadlocking on its own lock.

## Decisions

- **Exhausted wait = tool error**, so a driver retries later instead of
  recording a red that says nothing about the code.

## Test Plan

Fake memory reader and fake clock injected; lock contention between two child
processes; stale pid takeover.

## Acceptance Traceability

- 1–5 → `test/verify-queue.test.js`

## Commands

```bash
npm test
```
