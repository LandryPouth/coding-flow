# Tasks — Story 01-03

- [x] Targeted discovery: confirm the exact `codex sandbox` invocation and
      denial signal (may require a local `codex` install to observe once).
- [x] Write `bin/lib/codex-probe.js`: spawn + bounded timeout + three-way
      interpretation (`ok: true|false|null`).
- [x] Wire the probe into `doctor.js` and `init` (target === "codex"),
      auto-skip when `codex` isn't on PATH.
- [x] Extend the platform-evidence record shape with `probe`.
- [x] Extend `## Platform coverage` rendering with the probe outcome.
- [x] Write tests per `plan.md` (unit + gated integration).
- [x] Run `npm test`; fix; capture verify.

## Result

Codex probe (`bin/lib/codex-probe.js`) runs the real `codex sandbox` against a denied directory from `doctor` and `init`, records `probe: {ran, ok, detail}` as platform evidence, earns the `sandbox` tier only on a denied write, and shows in `report`. Negative control on a real codex: a profile that denies nothing is caught. Found while observing: deny globs only protect files that already exist (see plan.md Decisions).

### Rollback Notes

`git revert` the commit; evidence records already written keep a harmless extra `probe` field.
