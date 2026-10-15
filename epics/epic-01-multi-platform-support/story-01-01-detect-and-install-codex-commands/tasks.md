# Tasks — Story 01-01

- [x] Targeted discovery: re-read `bin/lib/config.js`, `bin/lib/templates.js`,
      `bin/lib/report.js` in full to confirm nothing drifted since planning.
- [x] Write `bin/lib/detect.js`: `resolveTarget({flags, env, cwd})`.
- [x] Add `target`/`TARGETS` to `bin/lib/config.js`.
- [x] Decide and implement the templates.js platform-aware materialization
      path (record the choice in `plan.md`'s Decisions section).
- [x] Write `bin/lib/platforms/codex.js` (command renderer).
- [x] Confirm Codex's real project-vs-user prompt convention; record it.
- [x] Wire `--target` into `bin/ai-flow.js`'s `init`: detect → materialize →
      write `platform`-kind evidence.
- [x] Add `kind` field to evidence records; update `report.js`'s `readRuns`
      to prefer it, falling back to the filename heuristic.
- [x] Add `## Platform coverage` to `report.js`'s `buildReport`/`renderMarkdown`.
- [x] Add the `docs/design-decisions.md` freeze-exception entry; update
      `docs/plans/multi-agent-install.md`'s capability table (note the
      sandbox mechanism, forward-reference story 2 for the guard itself).
- [x] Write tests per `plan.md`'s test plan.
- [x] Run `npm test`; fix; capture verify.

## Result

Implemented STRICT in worktree `epic-01-multi-platform-support` (branched from
`feat/opencode-guard`).

- New: `bin/lib/detect.js`, `bin/lib/platforms/codex.js`,
  `bin/lib/platforms/evidence.js`; tests `detect`, `config-target`,
  `platform-install-codex`, `report-platform-coverage`.
- Changed: `config.js` (`TARGETS`, `target`, `writeConfigTarget`), `templates.js`
  (`target` param, `copyCodexSkills`, no cross-platform prune), `ai-flow.js`
  (`init --target`, evidence, Claude hook only for claude), `doctor.js`
  (target-aware required files), `report.js` (`kind` from the record,
  `## Platform coverage`), `scripts/test-env-guard.js` (pins `CLAUDECODE=1`).
- Docs: design-decisions entry 10 and the multi-agent-install supersession note
  were already in place from planning; epic index gained testing notes.

### Rollback Notes

Pure code + one config field. `git revert` the story commit. A project that ran
`init --target codex` keeps `.codex/skills/` and a `target` key in
`.coding-flow/config.json` (`readConfig` ignores unknown targets by falling back
to `unrecognized`); delete `.codex/skills` by hand if wanted. No data migration.

## Status: done
