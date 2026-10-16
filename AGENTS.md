# Working on coding-flow

Read by OpenCode (natively) and by Claude Code (through `CLAUDE.md`). The full
contributor guide is [`docs/contributing.md`](docs/contributing.md); what was
decided and refused, with the measurements, is
[`docs/design-decisions.md`](docs/design-decisions.md) — read it before proposing
a daemon, a rewrite, or policy in skill frontmatter.

## Hard rules

- **Zero runtime dependencies.** `node:*` only; `git`/`gh` are optional shell-outs.
- **Edit `templates/.claude/skills/`, never `skills/`.** `skills/` is generated:
  run `node bin/ai-flow.js plugin sync` after a skill change (`plugin check` is in
  the tests). Every skill needs `evals/cases/<name>.json` in the same commit.
- **Behavioural tests** with `node:test` on throwaway directories (`mktemp -d`):
  assert what is observable (files, exit codes, output), never the narrative.
  `npm test` must be green before a commit; it also runs on `pre-push`.
- **Idempotent and non-destructive.** Every write has a `--dry-run`; a user's file
  or a file they edited is never overwritten or deleted without `--force`.
- **A guard that is not verified is not claimed.** A platform gets a guard only
  when it was seen refusing a write for real (see design-decisions entry 10).
- Delete files with `trash`, never `rm`.
- `CHANGELOG.md` gets an entry under `[Unreleased]` for any user-visible change.

## Running it from the checkout

```bash
npm test                              # the whole suite
node bin/ai-flow.js <command>         # the CLI, from this checkout
node bin/ai-flow.js doctor            # this repository's own install
```

This repository installs Coding Flow on itself (`--minimal`): the guard runs here
too — from Claude Code through `.claude/settings.json`, from OpenCode through
`.opencode/plugins/coding-flow-guard.js` — both pointing at this checkout's
`bin/`, so a guard change is live as soon as it is saved.

After a clone, or after changing a skill, refresh the OpenCode skills (they are
generated and not tracked):

```bash
node bin/ai-flow.js upgrade
```
