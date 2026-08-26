# Tasks — Story 01-03

- [ ] Targeted discovery: confirm the exact `codex sandbox` invocation and
      denial signal (may require a local `codex` install to observe once).
- [ ] Write `bin/lib/codex-probe.js`: spawn + bounded timeout + three-way
      interpretation (`ok: true|false|null`).
- [ ] Wire the probe into `doctor.js` and `init` (target === "codex"),
      auto-skip when `codex` isn't on PATH.
- [ ] Extend the platform-evidence record shape with `probe`.
- [ ] Extend `## Platform coverage` rendering with the probe outcome.
- [ ] Write tests per `plan.md` (unit + gated integration).
- [ ] Run `npm test`; fix; capture verify.

## Result

_(filled by /flow-run — include Rollback Notes)_

### Rollback Notes
