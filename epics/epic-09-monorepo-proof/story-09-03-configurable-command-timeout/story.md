# Story 09-03 — Configurable command timeout

`runValidationCommand` (`harness.js` ~1374) kills every command at 600 s.
bethl's forced test suite runs at a 183 s median and hit 773 s; two runs died
with exit 124 and were recorded as failures of the code, not of the limit.

*(QUICK — one config key, one output line.)*

## Acceptance Criteria

- [ ] `config.json` `validation.timeoutMs` (global) and the object form
      `{ "command": "npm run test -- --force", "timeoutMs": 1200000 }` inside
      `validation.commands` / `quality` are accepted; string entries keep
      working.
- [ ] A timed-out result says `timeout after 600 s (validation.timeoutMs)`
      in the verify output, naming the knob.
- [ ] `commandsFingerprint` includes the timeout (a different limit is a
      different command contract).
- [ ] Tests with a `node -e "setTimeout(()=>{}, 2000)"` command and a 500 ms
      limit; `npm test` green; CHANGELOG.

## Status: planned
