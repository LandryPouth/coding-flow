# Plan — 29-03 Destructive commands wait for the human

## Implementation Context

- Mode: STRICT. Scout: yes — `guard.js` and `shell-writes.js` are large and
  already read compound commands, wrappers and `cd`; map where a command
  verdict (not a write target) can be added without a second reader.
- Likely files: new `bin/lib/destructive.js` (rules table, pure: words in,
  verdict out), `bin/lib/guard.js` (call it for Bash, deny/warn, denials),
  `bin/lib/security-policy.js` / guard config reader (`destructiveCommands`,
  `allowDestructive`, `worktrees.primaryLocked`), `skills/flow-run/SKILL.md`
  + template copy (one line), docs.
- Avoid: a new shell parser; reading the disk inside the rules (the primary
  checkout check goes through the `host` the guard already passes).

## Decisions

_(to fill)_

## Test plan

- TDD on the rules table: each row denied, its near-miss allowed
  (`git reset --soft`, `git push`, `git clean -n`, `git switch -c` in a
  linked worktree, `rm file`).
- Wrappers: `bash -c`, `sh -c`, `env X=1`, `xargs`, `eval`, `;`/`&&`/`||`/`|`.
- Policy: deny / warn / off, `allowDestructive` exact prefix, unreadable
  `harness.json` (default policy, recorded).
- Red→green for every denial row (break the rule, see the test fail).

## Acceptance Traceability

_(to fill)_

## Commands

```
npm test
npm run lint
```
