# Story 08-02 — Plan

## Implementation Context

- **Execution mode**: STRICT.
- **Likely files**: `bin/lib/harness.js` — `commandsFingerprint` (~2316) is
  the model; evidence assembly (~2290–2310); `findReusableVerify` (~2344).
  `bin/lib/audit.js` — `isStale` (~288), `entryFromRunFile`,
  `latestVerifyByStoryDir` (~322). `bin/lib/status.js` — stale display.
  Tests in `test/harness.test.js`, `test/audit.test.js`, `test/status.test.js`.
- **Areas to avoid**: `identity.js` tree token — unchanged.

## Decisions

- `isStale(entry, currentToken, currentPolicy)` gains an optional third
  argument; review evidence (`latestReviewByStoryDir`) does not pass it — a
  review verdict does not depend on harness policy.
