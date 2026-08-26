# Tasks — Story 01-02

- [ ] Targeted discovery: re-read `bin/lib/settings.js` (the four-state
      contract to mirror) and `bin/lib/guard.js`'s `loadPolicy`/blocked-path
      logic (the source of truth to feed the profile, not duplicate).
- [ ] Write `bin/lib/codex-settings.js`: profile renderer + marker-gated
      `ensureCodexSandbox`-equivalent.
- [ ] Wire it into `bin/ai-flow.js`'s `init` (target === "codex") and
      `upgrade`.
- [ ] Extend `doctor.js`'s `checkGuardWiring` with the Codex branch.
- [ ] Write tests per `plan.md`.
- [ ] Run `npm test`; fix; capture verify.

## Result

_(filled by /flow-run — include Rollback Notes)_

### Rollback Notes
