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

Taken by the run (2026-11-22, unattended); the maintainer reviews afterwards.

- **D1 — One reader, no second parser.** `bin/lib/destructive.js` is pure (words
  in, findings out) and reads the line with `shell-writes.js`' `splitSegments` and
  `commandOf` (now exported), so wrappers (`sudo`, `env`, `nohup`, `timeout`…),
  quotes and segments are read exactly as for writes. It follows `bash -c`/`eval`
  (4 levels), `xargs`, `find -exec`, `npx`/`bunx`/`pnpm exec`/`yarn dlx`/`pnpm
  prisma`, and tracks `cd`/`pushd`/subshells/`git -C` lexically. What needs the
  disk comes back as a `check` the guard settles (`git status`, `git rev-parse`,
  `git clean -n`), never inside the rules.
- **D2 — The spec's premise was wrong: `harness.json` was not a blocked path.**
  An agent Edit to it was allowed, and the strict-mode tests (`guard-strict`)
  assert it must stay so (the user repairs a broken file through their agent).
  Blocking the file would break that and `/flow-recover`'s "declare
  `redAtBase.command`". Decided: a write tool may edit it, **unless the edit
  loosens the destructive policy** (lower `destructiveCommands`, a new
  `allowDestructive` entry, `primaryLocked` true→false), computed by applying the
  Write/Edit/MultiEdit to the file and comparing both parses. Tightening is
  allowed. A **shell** write, move or removal of the file is refused outright: the
  guard cannot read what it changes (the file is added to the blocked paths for
  shell targets only, so trees, links and `mv` are covered by the existing judges).
- **D3 — Order:** blocked writes, then secrets, then destructive commands; an
  unsettled destructive check joins the call's issues (unchecked) and never hides
  a refusal found later.
- **D4 — `allowDestructive`** is matched word by word on the command as read
  (wrappers and git's global options removed): `sudo rm -rf node_modules` matches
  `rm -rf node_modules`; `git -C x clean -fdX` matches `git clean -fdX`. A prefix
  is exact: `node_modules` does not allow `node_modules_old`.
- **D5 — Policy reading:** anything but `"warn"`/`"off"` is `deny` (typo, broken
  file). `primaryLocked` is true only for the literal `true`. The primary
  checkout's own policy also locks it (`git -C <primary> switch` from a linked
  worktree whose policy says nothing).
- **D6 — Warn mode** logs to a new `guard-warnings.jsonl` (not `denials.jsonl`,
  whose readers mean "refused"), prints on stderr and as a `systemMessage`
  without a permission decision (the user's own permission rules still apply).
  Ignored by git and removed by `uninstall`.
- **D7 — Expansions.** For a guarded git subcommand, any word with `$`/backtick
  makes the call unchecked when no rule matched (`git push origin $REFSPEC` may
  be a `+refspec`); `git $SUB` too. For `rm`, only an option word with an
  expansion (`rm -$F x`) is unchecked; `rm "$file"` is read as a path, or every
  script would be noise. Accepted cost: `git push origin "$(git branch
  --show-current)"` is unchecked (refused in strict); `git push origin HEAD` is
  the plain form.
- **D8 — Rows read as the spec words them, with these readings:**
  `git checkout <x>` is a path restore when `x` exists on disk or is `.`, else a
  branch change; `git restore --staged` alone touches no work tree (allowed);
  `rebase`/`merge` `--abort|--continue|--quit|--skip` are allowed (they resume
  or undo what is under way); `git reset --hard` is refused even on a clean tree
  (it moves the branch). The "files at risk" are the tracked modified files
  (`git status --porcelain --untracked-files=no`, 5 shown), or what `git clean
  -n` with the same `-d/-x/-X` lists.
- **D9 — Out, said in rules-and-limits:** `git push --delete`/`--mirror`, `git
  pull` (it merges), `find -delete`, a heredoc fed to `psql`, `npm run <script>`,
  `mysql -e`, `docker compose down -v`, PowerShell. Each can be a later row.
- **D10 — Credentials never reach the log:** the command in a refusal has
  `//user:pass@` masked and long words cut (the secret check, which runs first,
  catches the known formats).
- **D11 — This repository does not set `primaryLocked`.** The run's land script
  merges in the primary checkout; the maintainer decides (Human to-do).

### Review round 1 (independent, 7 P1) — decided

- **D12 — Past 4 nested scripts the call is unchecked** (`eval`×5, `bash -c`×6),
  never allowed. `bash -c -- 'x'` reads the script after `--`.
- **D13 — Forwarded commands step their wrappers** (`xargs sudo rm`, `find -exec
  env rm`) through `shell-writes`' `verbAt`, now exported. The wrappers read there
  grew: `stdbuf`, `ionice`, `chroot DIR`, sudo's long options with a value
  (`--user root`), `fish -c`; `watch …`, `su -c`, `script -c` and `env -S` /
  `--split-string` hand a script on, which is read.
- **D14 — A long option is read by prefix** where it makes a command destructive
  (`--har`, `--forc`, `--rec`, `--del`, `--discard`), as git and GNU tools accept
  an unambiguous prefix; an exemption (`--dry-run`, `--staged`, `--patch`,
  `--help`) is read exactly. An ambiguous prefix (`git push --f`) is read as the
  destructive option: git refuses it anyway.
- **D15 — `git checkout -f` / `--force`, `git switch -f` / `--discard-changes`**
  discard every uncommitted change: refused when the repository has one
  (`git status -- :/`), like a checkout of a modified path; allowed on a clean
  tree, where they destroy nothing.
- **D16 — The policy file from a shell, completed.** Every path a remover
  (`rm`, `unlink`, `trash`, `shred`, `git rm`) or `mv`/`git mv` takes away is
  checked against the file **and the directories holding it** (`trash
  .coding-flow`, `mv .coding-flow x`, `trash .`); what `cp`/`install`/`ln`
  overwrite is checked too (`cp /dev/null F`, which the write reader drops). A
  glob is matched (`harn*`, `harness.jso?`, `[h]arness.json`, `.codi*/…`); an
  expansion that may name it (`.coding-flow/$X`) is unchecked. `find … -delete` /
  `-exec rm` is refused when a start holds the file and its `-name`/`-path`
  tests let it through (`-regex` is read as matching).
- **D17 — On a case-insensitive file system `HARNESS.json` is the policy file**
  for the write tools as for the shell. A NotebookEdit of it is refused.
- **D18 — `git -c alias.…` on the command line is unchecked**: the alias may run
  anything (`!rm -rf`, `reset --hard`).
- **D19 — A Write switching `mode` from strict to standard stays allowed.** The
  reviewer notes it reopens the unchecked forms. Kept by design: `strictOutcome`
  exists so that strictness can never lock the user out of switching back through
  their agent (design-decisions, `guard-strict` tests). `destructiveCommands`
  stays `deny` in standard: only what the reader cannot settle reopens.
- **D20 — A pre-existing reader bug fixed on the way:** `reduceWord` stripped
  backslashes twice, so a quote escaped inside a quoted word lost a level and a
  nested `bash -c` was misread (writes too). One pass now (test in
  `shell-writes.test.js`, red on the old reader).
- **D9 (extended) — still not read, listed in rules-and-limits:** `npx rimraf`,
  `rsync --delete`, `python -c "shutil.rmtree(…)"`, `git update-ref -d`, `git
  reflog expire`, `git gc --prune=now`, `git filter-branch`, `git rm -rf`.

## Security

- **Who can lift a refusal?** Only a human edit of `harness.json`. An env var, a
  flag, a wrapper or `bash -c`/`eval` does not (tests: "an environment variable, a
  flag or a wrapper…"). An agent write that loosens the policy is refused (D2).
- **Fail-open?** Only on what the reader cannot settle (an expansion, an unknown
  directory, git timing out), recorded as unchecked and refused in `strict`.
  A parsed destructive command is never allowed silently.
- **False positives?** Text is not a command: `echo`, `grep`, a commit message
  (tests). A clean `git checkout -- <file>` is allowed.
- **Data in logs?** The reason carries the command, masked (D10); `path` is null
  or the policy file.

## Test plan

- TDD on the rules table: each row denied, its near-miss allowed
  (`git reset --soft`, `git push`, `git clean -n`, `git switch -c` in a
  linked worktree, `rm file`).
- Wrappers: `bash -c`, `sh -c`, `env X=1`, `xargs`, `eval`, `;`/`&&`/`||`/`|`.
- Policy: deny / warn / off, `allowDestructive` exact prefix, unreadable
  `harness.json` (default policy, recorded).
- Red→green for every denial row (break the rule, see the test fail).

## Acceptance Traceability

All in `test/guard-destructive.test.js`:

1. `git reset --hard HEAD~1` → "git reset --hard is refused with the rule, the files at risk and git stash push -u, and logged"
2. `cd repo && git push origin +main` → "a compound command, a cd and a wrapper are read through…" (`cd sub && git push origin +main`)
3. `primaryLocked` + `git switch` → "git switch in the primary checkout is refused when primaryLocked; the same in a linked worktree is allowed"
4. `bash -c "rm -rf build"` → "…names trash build when trash is on PATH"
5. `npx prisma migrate reset --force` → "npx prisma migrate reset --force is refused, naming the human"
6. `allowDestructive` → "allowDestructive allows exactly its prefix…"
7. `warn` → "destructiveCommands warn: the command is allowed, the warning printed and recorded"
8. harness.json → "the agent cannot allow itself: a write that loosens the policy file is refused, by any tool" (premise corrected, D2)

Every row of the table: "each refused form is denied; its near miss is allowed".
Red→green: each rule was broken in turn (22 mutants of `destructive.js` and
`guard.js`) and the file went red every time.

## Commands

```
npm test
npm run lint
```
