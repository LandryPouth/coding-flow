# Story 29-04 — Plan

## Implementation Context

- **Execution mode**: STRICT (guard).
- **Depends on**: 29-03 (destructive reader, backstops, D9 list).
- **Likely files**: `bin/lib/destructive.js`, `bin/lib/shell-writes.js`,
  `test/guard-destructive.test.js`, `test/guard-evasion.test.js`,
  `bin/lib/guard.js`, `docs/rules-and-limits.md`.
- **Scout pre-step**: no.

## Decisions

- **Origin (2026-11-24):** 29-03 hit the review cap (four rounds, new
  bypasses each). The run re-scoped 29-03's claim to habitual forms and moved
  the evasion forms its reviews found (interpreter strings, two-step git
  alias, script files) here, as P2 under the new claim.
- **Unchecked, not refused:** an interpreter string can hold the words for a
  good reason (a test, a doc); the guard flags it, strict mode refuses it.
- **D1 — Unproven findings.** Text the guard reads on behalf of something that
  runs it later or elsewhere (interpreter literals, a `git config alias.x`
  value, a file the line wrote, psql's `\!`) is read with the 29-03 reader;
  its findings carry `unproven: <reason>`. `judgeDestructive` settles each
  finding's check as usual (so `rm` of a clean file inside `python -c` does
  not fire), then records the reason as unchecked instead of refusing. One
  reader, one set of rules; only the outcome changes.
- **D2 — Interpreter code.** `inlineCode`/`stringLiterals` are exported from
  `shell-writes.js` (no new module: the guard's graph stays at 6). Each
  literal with whitespace, and the literals joined by a space and by nothing,
  are read as scripts. Joined literals matching the policy-file text, or a
  program that builds strings (`+`, `.`, adjacent literals, `%`, `.format`,
  f-strings, `${`, `.join(`, `sprintf`) from a piece naming `harness` /
  `coding-flow` or starting with a destructive verb, are unchecked. API calls
  (`shutil.rmtree`, `fs.rmSync`) are not read: a stated limit. `php -r` was
  added to the interpreters `shell-writes` reads (a tightening for the
  policy-file check too).
- **D3 — Removing a file with uncommitted changes.** `rm`, `unlink`, `shred`
  and `git rm -f`/`--force` (not `--cached`) of named paths get a `dirty`
  check; the disk decides, as for `git checkout -- f`. Refused, not
  unchecked: the command runs here and the loss is proven by `git status`.
  Not judged: an operand set by an expansion, a directory the line made
  unknown (`cd "$d" && rm f`, it would make every such line unchecked), and a
  plain `rm` handed to `ssh` or a wrapper the guard does not read (marked
  `local`, so a remote `rm` is never this repository's). `trash` is the
  stated alternative and is never flagged. The 29-03 near miss `rm a.txt`
  (a.txt is modified in that fixture) now contradicts criterion 7: it was
  replaced by `rm b.txt` / `rm -f b.txt` on the clean file, the same near
  miss; the Lens B everyday list is untouched.
- **D4 — git config alias.** `git config [scope] [--add] alias.x VALUE` and
  `git config set alias.x VALUE`: a `!` value is read as a shell script, any
  other as `git VALUE`; destructive → unchecked when it is set. Lookups
  (`--get`, no value) and other keys stay allowed.
- **D5 — Prefix env.** `GIT_DIR`, `GIT_COMMON_DIR`, `GIT_CONFIG*`, `HOME`,
  `XDG_CONFIG_HOME` before git (bare or through `env`) make a non-builtin
  subcommand unchecked: the alias the guard would resolve is not the one git
  reads. `GIT_DIR`/`GIT_WORK_TREE`/`GIT_INDEX_FILE` other than `.git` make
  the directory unknown, so dirty/primary checks are unchecked.
  `GIT_DIR=.git` is this repository.
- **D6 — Written then run.** `readLine` tracks the files the line writes
  (`>`, `>>`, `tee`, `curl -o`, `wget -O`, `cp`/`mv`/`install`/`ln` target),
  with their text when it is `echo`/`printf` output (`\n` read as a line
  break). Running one (`bash f`, `sh f`, `source f`, `. f`, `./f`, an
  interpreter with a file operand): known text is read (as a script, or as
  interpreter code), unknown text is unchecked. A file the line did not
  write (`bash scripts/build.sh`, `python script.py`) is not read: a stated
  limit.
- **D7 — psql.** `DROP DATABASE|SCHEMA|TABLE` and `TRUNCATE` in `-c`,
  `--command`, `--command=`, `-cSQL` are refused (they run here and destroy
  data). psql reading its input (pipe, `<`, heredoc) with no `-c`/`-f`:
  echoed SQL that is harmless is allowed, destructive or unseen SQL is
  unchecked. `\!` text is read as a script (unproven). `psql -f FILE` is not
  read: stated limit. Other clients (`mysql -e`, `sqlite3`) stay in the
  table.
- **D8 — The table.** `docs/rules-and-limits.md` gets one table, *Destructive
  commands the guard does not read*: form, what the guard does, what covers
  it. `test/guard-evasion.test.js` asserts every 29-03 D9 form is in it, and
  checks that list against 29-03's plan.md while it is in the checkout.
- **D9 — Latency.** No new shell-out: the new readers are string work on the
  line; `rm` of a named file adds the `git status` probe 29-03 already runs
  for `git checkout -- f` (one per call, cached). Measured on 29-03's
  everyday list plus 5 (32 commands, 3 rounds, load average 11–19): before
  2.7 / 1.4 / 1.2 ms per command, after 2.6 / 1.2 / 0.8 ms — within noise.

## Test Plan

`decide()` on throwaway repos for each criterion; the 29-03 Lens B list
re-asserted.

## Acceptance Traceability

See tasks.md (one line per criterion).

## Commands

```bash
npm test
```
