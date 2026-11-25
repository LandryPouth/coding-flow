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

### Review round 2 (fresh reviewer, security lens: FAIL, 3 P1) — each fix has a test that failed before it

- **R2-P1-1 — ReDoS, the guard failed open.** The literal-list regex had
  overlapping `\s*` inside a repeated group: 16 items took 7.5 s, 22 never
  finished, past the hook's 60 s the call runs. Interpreter code is now read
  by `codeTokens`, one pass over the characters (quoted literals and other
  marks); literals and argument lists come from the tokens, no regex. Code
  over 64 KB is unchecked, unread. Audit of every regex this story added or
  changed: `BUILDS` had `\s*(?:\+|\.)?\s*` (two `\s*` around an optional,
  quadratic on a run of spaces) → `\s*(?:[+.]\s*)?`; SQL comment and literal
  stripping is now a one-pass scanner (`sqlCode`), the `DELETE` test two
  plain regexes per statement; the psql cluster, glued interpreter flags,
  redirect, env and heredoc regexes have no nested or overlapping
  quantifier. A test decides 16 hostile 10 KB inputs (one per reader), each
  in a child process killed at 20 s, bound 1 s; measured worst 141 ms at
  load ~2 (the old list regex: never finishes).
- **R2-P1-2 — psql flag clusters.** `-tAc SQL`, `-Atc`, `-qc'…'`, `-tAf
  FILE`: a cluster of psql's no-value switches ending in `c` or `f`, with the
  value glued or next.
- **R2-P1-3 — `\!` outside `-c`.** psql's meta-commands are read in every
  SQL source: `-c`, `-f` files, `<` files, heredocs, echoed stdin. `\!` is
  read as a script (unproven → unchecked when destructive); `\i`, `\ir`,
  `\include`, `\o` into a pipe, `\copy … program` are unchecked.
- **R2-P2 fixed.** `(echo …) > f`: the redirect after a closing group is
  recorded, its text unknown → running `f` is unchecked (as `{ …; } > f`).
  `DELETE FROM` is destructive when its statement has no `WHERE` anywhere
  (alias, `AS`, `USING`, `RETURNING`). SQL string literals (`'…'`,
  `$$…$$`) and comments are blanked before matching: `SELECT 'drop table x'`
  is allowed. `tokenize` now keeps a backslash inside double quotes before
  anything but `$`, a backtick, `"`, `\` and a newline, as bash does — it
  had turned `"\! rm -rf build"` into `! rm -rf build` (shared with the
  shell-write guard, where it only stops treating `".e\nv"` as `.env`, which
  bash does not write either).
- **R2-P2 listed.** `rm *.txt`, a submodule, a symlinked directory, a
  case-insensitive file system; a word with escaped spaces
  (`psql -qcDROP\ TABLE\ t`: `commandOf` splits it, 29-03's tokenizer);
  psql `\i`/`\o`; `node -e 'console.log("rm -rf is dangerous")'` is
  unchecked — accepted noise, since reading only the literals a call runs
  would miss `cmd = "rm -rf x"; system(cmd)`.
- **D9 restated (latency, 2026-11-25, load 12–17).** In-process `decide()`
  over 29-03's everyday list plus 9 (36 commands; config, alias, psql,
  heredoc, `rm`), 7 rounds, base `3c90919` vs HEAD back to back: base cold
  2.05 / 3.42 ms, warm median 1.13 / 1.13 ms per command; HEAD cold 3.07 /
  2.20 ms, warm median 0.93 / 0.89 ms. The hook as a process (`ai-flow
  guard`, 35 calls): base median 126 / 110 ms, HEAD 115 / 198 ms — node
  start-up and load dominate, no difference the noise lets through. The
  reviewer's 5.1–6.0 vs 3.2–3.5 ms was measured on round 1, before `rm` read
  the index.

### Review round 3 (fresh reviewer, tests/spec/scanners lens: FAIL, 1 P1 — a regression)

- **R3-P1 — the SQL scanner blanked code Postgres runs.** `select 1 as
  "a--b"; DROP DATABASE prod`, `select "/*"; …; select "*/"`, `x$a$ … y$a$`,
  `E'\\''`: refused at 3c90919, allowed after round 2. **Structural rule —
  monotonic:** a scanner may only add refusals. `DROP DATABASE`, 29-03's
  check, reads the raw text again, exactly as 3c90919 did (so `SELECT 'drop
  database x'` is refused again: accepted noise, in the table; the CHANGELOG
  no longer claims otherwise). The checks this story added (`DROP SCHEMA`,
  `TABLE`, `OWNED`, `COLUMN`, `ALTER TABLE … DROP c`, `TRUNCATE`, `DELETE`
  with no `WHERE`) read the blanked text, from a fixed scanner: a `"…"`
  identifier is opaque (`""` inside), a dollar quote opens only where it can
  (not after `[\w$]`, tag `[A-Za-z_]\w*` or empty), a backslash escapes inside
  `E'…'`. Interpreter code: 3c90919 refused nothing there (its backstops on
  the raw words still run unchanged), and a destructive verb in the raw code
  that no literal holds is now unchecked — so a comment that throws the quote
  pairing off (`# don't`) cannot hide one.
- **The class cannot come back silently:** a differential test holds 105
  cases (every SQL and interpreter case of the file, plus round 3's four),
  each with the decision 3c90919 gave on the same fixture, recorded by
  running 3c90919 and hard-coded. HEAD must be at least as strict on every
  one (deny > unchecked > allow).
- **R3-P2 fixed.** `-H` in psql clusters. `ALTER TABLE t DROP c` (no
  `COLUMN`; `DROP CONSTRAINT`, `DEFAULT`, `NOT NULL`, `IDENTITY`,
  `EXPRESSION` are not data). A redirection before the command
  (`<drop.sql psql app`, `>out.txt git reset --hard`, `2>/dev/null git …`)
  is read past — these were unchecked at 3c90919, now read; `psql app 0<
  drop.sql` reads the file like `<`. The round-2 `tokenize` change has its
  CHANGELOG line and its own test (`> "\.env"` allowed, `> .env` refused).
- **R3-P2 listed.** Octal escapes, `printf`/`%` formats, Perl
  `qx{}`/`q{}`/`qw()`; psql `\gexec`, `\set`/`:var`.

### Review round 4 (LAST of the first series, fresh reviewer: FAIL, 2 P1 regressions) — the cap

- **Series history (D-cap).** Four rounds, P1 per round: 2 / 3 / 1 / 2. Rounds
  3 and 4 found **regressions** against 29-03 (round 3: the SQL scanner;
  round 4: `GIT_WORK_TREE=. git checkout -- a.txt` and `HOME=/x git nuke`
  went from deny to unchecked — the prefix checks ran before 29-03's own).
  Each round closed a form; the class — a new reader overriding an old
  decision — stayed open. The run re-scoped structurally and starts a new
  review series from round 1.
- **R4 re-scope — strictest of two readers.** `bin/lib/destructive-29-03.js`
  is 3c90919's `destructive.js`, byte for byte (a header comment added),
  frozen. `guard.js` (`strictestReading`) runs it and judges its findings
  exactly as 29-03 did; then runs `destructive.js`, this story's reader, and
  judges its findings too. A refusal from either is the refusal (29-03's
  first); an unchecked from either is unchecked; the touched paths and
  substitutions of both are checked. No reader added later can weaken a 29-03
  decision: it can only add a refusal or an unchecked. Judging is unchanged
  for 29-03's findings (`unproven` and `worktree` exist only on new ones; the
  same check on the same paths is answered once per call, which changes no
  answer). The frozen module is loaded lazily, like `destructive.js`: the
  guard's load-time graph is unchanged (6), a Bash call loads one more module.
- **`shell-writes.js` returned to 29-03's behaviour.** `tokenize`'s backslash
  rule is 29-03's again, and `php -r` / glued interpreter flags left
  `inlineCode`: glued flags could weaken the shell-write guard (`echo x |
  python3 -c'print(1)'` was unchecked as a piped program, then allowed).
  Only additive data remain (heredoc bodies on segments, two exports). The
  destructive reader keeps bash's backslashes for psql on its own
  (`bashArgs`), and reads `php -r` and glued flags itself
  (`interpreterPrograms`). The 11 `"\…"` forms (`> "\.env"`) are refused
  again: accepted noise, in the table.
- **R4-P2.** `alter table t drop "Email"` refused. Under a prefix that only
  swaps the global or system config file (`HOME`, `XDG_CONFIG_HOME`,
  `GIT_CONFIG_GLOBAL`, `GIT_CONFIG_SYSTEM`), an alias the repository defines
  (`git config --local`) wins, so it is read as usual: `HOME=/x git st` is
  allowed, `HOME=/x git nuke` refused; command-line config
  (`GIT_CONFIG_COUNT`/`KEY`/`VALUE`, `GIT_CONFIG_PARAMETERS`, `GIT_CONFIG`,
  `GIT_DIR`) stays unchecked. **Budget:** the new reader stops after 3 s from
  the call's start (`deadline`), and the judging of its findings too: the rest
  is unchecked, never allowed (`rm build; ` × 2000 now asks git once — 30 s
  before; 9 000 `\!` lines end unchecked). 29-03's reader has no budget: its
  decisions are kept as they were.
- **Tests.** The reviewers' corpus (568 commands from c1–c7: env-prefixed git
  on a dirty file, aliases in `.git/config` under each config prefix,
  `sudo`/`cd` prefixes, backslash forms, SQL, interpreters, everyday) with the
  decision 3c90919 gave on their fixture, recorded by running 3c90919, in
  `test/fixtures/guard-29-03-decisions.json`; HEAD ≥ base on every one (0
  weaker, 179 stricter). The hostile-input bound now times this story's
  reader alone. All round-4 tests fail on the round-3 code.
- **D9 restated (2026-11-25, load 23–30).** In-process `decide()`, 36
  commands, base vs HEAD back to back: cold 7.3 / 9.3 ms vs 14.5 / 14.4 ms
  per command (a second reader module loads); warm median 2.1 / 3.0 ms vs
  1.4 / 3.3 ms. The hook as a process (35 calls): median 301 / 310 ms vs 334 /
  351 ms (+10 %, two readers and the frozen module's parse, under load 30).

## Test Plan

`decide()` on throwaway repos for each criterion; the 29-03 Lens B list
re-asserted.

## Acceptance Traceability

See tasks.md (one line per criterion).

## Commands

```bash
npm test
```
