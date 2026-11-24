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

### Review round 1 (fresh reviewer: FAIL, 2 P1) — each fix has a test that failed before it

- **R1-P1-1 — heredoc-written scripts were never read.** `splitSegments`
  now keeps each heredoc's body on the segment that opened it
  (`segment.heredocs[]`, `body`, `closed`). `cat > f <<'EOF'` / `cat <<EOF >
  f` / `tee f <<EOF` with no input file write the body; an unquoted body that
  expands, or `cat part.sh > f <<EOF`, is unread. `cp SRC DEST` records
  `{ from }`: when DEST is run, SRC is read if it is a regular file of at most
  64 KB (`host.readSmall`, a read, no spawn), else unread. The same reading
  serves psql: a heredoc fed to psql, `psql < f.sql`, `psql -f f.sql` read the
  SQL (destructive → unchecked, unseen → unchecked, harmless → allowed).
- **R1-P1-2 — interpreter flag glued to its code.** `shell-writes` reads
  `python -c"…"` (`-[bBdEhiIOqsSuvVx]*c…`), `perl -e'…'`/`-E`, `ruby -e'…'`,
  `php -r'…'`. The prefix letters are only the switches that take no value,
  so `perl -Mfeature=say` is not read as code. node does not accept a glued
  `-e`.
- **R1-P2 fixed.** Escapes decoded in literals (`\n` splits commands,
  `\x20`, `\u…`); literals up to 4 KB read (shell-writes' 200-char cap for
  the policy-path check is unchanged); literal argument lists
  (`spawnSync("rm", ["-rf","build"])`, `subprocess.run([...])`) read as a
  command. A `local` finding (rm of a modified file) inside code that runs
  here — interpreter, written script, alias, psql `\!` — is kept, so it is
  unchecked; `ssh`/handed text still drops it. `>|` is a write. SQL: comments
  stripped, `DELETE FROM t` with no `WHERE`, `DROP OWNED`, `DROP COLUMN`.
  `GIT_CONFIG_NOSYSTEM`, `GIT_PAGER` no longer make an alias unchecked; only
  the variables that name another config file do. A plain `rm` of a change
  that is all staged is allowed (`check.worktree`: the index keeps it);
  `git rm -f` still counts staged changes.
- **R1-P2 listed (table).** exec/eval/base64; `core.hooksPath`,
  `include.path`, editing `.git/config`; `uv run`, `npx tsx -e`, awk
  `system()`, `lua -e`, `make -f`; `bash "$PWD/x.sh"`; `docker exec … psql`
  fed by a pipe; `git submodule foreach` (read with an unknown directory, so
  strict refuses its checks); `git stash && rm a.txt && git stash pop`
  (refused: noise accepted, the disk is read before the stash runs). The
  table test now also checks 29-03's D9 in both directions (every backticked
  form in its plan is in `D9_FORMS`); `git rm -rf` added.
- **R1 latency — `rm FILE` without `git status`.** A plain `rm`/`unlink`
  reads `.git/index` (v2/v3, at most 2 MB, `.git` file for worktrees): every
  path missing, untracked, or tracked with the recorded size and mtime and
  older than the index (git's racy rule) → no spawn. A split (`link`) or
  sparse (`sdir`) index, a conflict, a newer format or any mismatch → `git
  status` decides as before. Median per call, 20 runs, load ~2: base
  (3c90919) `rm a.txt` 0.4 ms, `rm build/o.js` 0.2 ms; round 0 2.8 / 2.5 ms
  (spawn); now 0.5 / 0.4 ms. Everyday list (32 commands): 0.8 / 0.3 / 0.3 ms
  per command over 3 rounds. Assumption, as git's: a file rewritten to the
  same size with its old mtime restored passes as clean.

## Test Plan

`decide()` on throwaway repos for each criterion; the 29-03 Lens B list
re-asserted.

## Acceptance Traceability

See tasks.md (one line per criterion).

## Commands

```bash
npm test
```
