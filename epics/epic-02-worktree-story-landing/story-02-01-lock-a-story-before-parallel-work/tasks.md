# Tasks — Story 02-01

- [x] Targeted discovery: re-read `worktree.js`'s `resolveStory`,
      `worktreeCommand`'s dispatcher, and `harness.js:477-500`'s
      `.gitignore` check.
- [x] Add `worktreeLock`/`worktreeUnlock` to `bin/lib/worktree.js` plus the
      `lock`/`unlock` branches in `worktreeCommand`.
- [x] Add the idempotent `.gitignore` append for
      `.coding-flow/active-story.json`.
- [x] Update `skills/flow-run/SKILL.md`: lock call before implementation at
      every intensity, unlock call paired with `## Status: done`.
- [x] Write tests per `plan.md`.
- [x] Run `npm test`; fix; capture verify.

## Status: done

## Result

`ai-flow worktree lock --story <dir>` / `unlock [--story <dir>] [--force]`
added to `bin/lib/worktree.js`'s dispatcher, reusing `resolveStory` for path
validation and `util.js`'s `readJson`/`writeJson` for the lock file. The lock
is a single `.coding-flow/active-story.json` (`{ story, startedAt }`),
matched on `story` only. `lock` idempotently ensures the repo's root
`.gitignore` covers the lock file (exact line, `.coding-flow`, or
`.coding-flow/*`) before writing. `skills/flow-run/SKILL.md` (both
`skills/` and `templates/.claude/skills/` — kept byte-identical per
`test/ceremony.test.js`) now calls `worktree lock` before implementation at
every intensity, and `worktree unlock` exactly once, paired with writing
`## Status: done`.

Acceptance criteria: 8/8 met, all covered by 11 new cases in
`test/worktree.test.js`. `npm test`: 477/477 green.
`ai-flow verify --story <this dir>`: green, `Coverage: evidence` (a test
file moved alongside 3 behavior files; this repo emits no lcov, so
`evidence` is the ceiling reachable here, not summarized as "covered").
`harness check` on this repo's own tree reports 2 pre-existing
`secret_candidate` errors in `test/guard.test.js`/`test/harness.test.js`
(their own secret-detector fixtures) and an `env_not_ignored` warning —
none touched by this diff; logged as a new row in `docs/DOGFOODING.md`
(2026-08-24) rather than worked around, since it is the same open,
unrelated root cause as the 2026-08-18 guard-surface row.

### Rollback Notes

`git revert` is sufficient: the change adds two new dispatcher branches, a
new gitignored runtime-state file, two SKILL.md edits, and new tests — no
migration, no existing behavior altered for `add`/`list`/`remove`. Deleting
a stray `.coding-flow/active-story.json` by hand (`worktree unlock --force`)
is the only manual cleanup a partially-run session could need, and that is
the escape hatch the story itself ships.
