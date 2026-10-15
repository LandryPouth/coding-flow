# Tasks — Story 01-02

- [x] Targeted discovery: re-read `bin/lib/settings.js` (the four-state
      contract to mirror) and `bin/lib/guard.js`'s `loadPolicy`/blocked-path
      logic (the source of truth to feed the profile, not duplicate).
- [x] Write `bin/lib/codex-settings.js`: profile renderer + marker-gated
      `ensureCodexSandbox`-equivalent.
- [x] Wire it into `bin/ai-flow.js`'s `init` (target === "codex") and
      `upgrade`.
- [x] Extend `doctor.js`'s `checkGuardWiring` with the Codex branch.
- [x] Write tests per `plan.md`.
- [x] Run `npm test`; fix; capture verify.

## Result

Codex sandbox profile (`.codex/config.toml`) generated from harness blockedPaths, wired into init/minimal init/upgrade, checked by doctor. Independent review: no blockers; non-string blockedPaths crash and trust wording fixed.

### Rollback Notes

`git revert` the commit; projects keep a marker-stamped `.codex/config.toml` that can be deleted by hand.

## Status: done
