# Tasks — Story 01-04

- [x] Read `~/dev/tools/ai-learn/bin/lib/platforms/{gemini,opencode,
      antigravity}.js` in full.
- [x] Write the three coding-flow renderers, porting escaping logic exactly.
- [x] Extend `TARGETS` in `bin/lib/config.js`.
- [x] Wire `--target` for the three into `init`.
- [x] Add the "guard not available on this host" informational line to
      `doctor.js` for these targets.
- [x] Write tests per `plan.md` (one file per platform, escaping edge case
      included).
- [x] Run `npm test`; fix; capture verify.

## Result

Gemini, OpenCode and Antigravity now install commands through
`bin/lib/platforms/{gemini,opencode,antigravity}.js`, with the shared source split in `skill-source.js`
and a registry. `copyCodexSkills`'s write loop became `syncRendered`, shared with
`copyPlatformCommands`. init/upgrade/doctor (`--fix`, required files, `notes`) cover the three.
Tests: three files over `test-support/commands-only-suite.js`, parse-checked with python3
tomllib/PyYAML (skipped when absent).

### Rollback Notes

`git revert` the story commit; no schema or data change. Projects already initialised keep their
rendered files, which are removed by deleting `.gemini/commands/coding-flow`, `.opencode/command/coding-flow` or `.agent/skills/flow-*` by hand (`ai-flow uninstall` does not know these directories yet, same as `.codex/skills`).

## Status: done
