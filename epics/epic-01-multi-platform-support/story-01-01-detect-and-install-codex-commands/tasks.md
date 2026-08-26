# Tasks — Story 01-01

- [ ] Targeted discovery: re-read `bin/lib/config.js`, `bin/lib/templates.js`,
      `bin/lib/report.js` in full to confirm nothing drifted since planning.
- [ ] Write `bin/lib/detect.js`: `resolveTarget({flags, env, cwd})`.
- [ ] Add `target`/`TARGETS` to `bin/lib/config.js`.
- [ ] Decide and implement the templates.js platform-aware materialization
      path (record the choice in `plan.md`'s Decisions section).
- [ ] Write `bin/lib/platforms/codex.js` (command renderer).
- [ ] Confirm Codex's real project-vs-user prompt convention; record it.
- [ ] Wire `--target` into `bin/ai-flow.js`'s `init`: detect → materialize →
      write `platform`-kind evidence.
- [ ] Add `kind` field to evidence records; update `report.js`'s `readRuns`
      to prefer it, falling back to the filename heuristic.
- [ ] Add `## Platform coverage` to `report.js`'s `buildReport`/`renderMarkdown`.
- [ ] Add the `docs/design-decisions.md` freeze-exception entry; update
      `docs/plans/multi-agent-install.md`'s capability table (note the
      sandbox mechanism, forward-reference story 2 for the guard itself).
- [ ] Write tests per `plan.md`'s test plan.
- [ ] Run `npm test`; fix; capture verify.

## Result

_(filled by /flow-run after implementation — include Rollback Notes)_

### Rollback Notes
