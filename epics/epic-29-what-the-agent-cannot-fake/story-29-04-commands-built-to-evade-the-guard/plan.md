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

### Series 2, review round 1 (fresh reviewer: FAIL, 1 P1 — a claimed form, not a regression)

The re-scope held: the frozen module is 3c90919's reader byte for byte apart
from its header, 3,023 commands read the same by both, and the 568 fixture
decisions match at base (0 weaker, 179 stronger at HEAD).

- **S2R1-P1 — a glob or brace hid a modified file from criterion 7.** `rm
  *.txt`, `rm a.*`, `rm a.t?t`, `rm [a].txt`, `rm {a,b}.txt`, `unlink a.*`,
  `git rm -f *.txt`, `rm ./src/*` were allowed: `removesChanges` emitted only
  for an operand on disk, and `indexHolds` took a glob word for a missing
  file. Fix: braces are expanded in `destructive.js` (`braceWords`: commas,
  nesting, `{1..9}`/`{a..e}` ranges; past 64 words, past 4 KB, or a stepped
  range → unchecked, never allowed); a glob operand always reaches the check;
  `indexHolds` returns false for a glob word; `settle` hands it to git as a
  `:(glob)` pathspec (`*` stops at `/`, as in bash). Where git matches more
  than bash (dotfiles) it is refused: noise, in the table. A glob outside the
  repository is decided as a literal path there is (allowed). A range is
  already never allowed: 29-03 refuses a word with `..` that could reach its
  policy file.
- **S2R1-P2-1 — the frozen reader pinned.** It read the live `shell-writes.js`,
  which this story changed (additively). `bin/lib/shell-writes-29-03.js` is
  now 3c90919's `shell-writes.js`, frozen; `destructive-29-03.js` requires it
  (its one line changed besides the header). A test hashes both files
  (header and that require aside) against the sha256 of 3c90919's files
  (`test/fixtures/guard-29-03-sources.json`), and another runs the frozen
  reader on the 568 commands with a host that spawns nothing and compares a
  hash of its full output per case with what 3c90919's reader returned
  (`git show 3c90919:` run from a scratch directory;
  `test/fixtures/guard-29-03-reader-outputs.json`). The output test passed
  before the copy too (the live module still reads those 568 the same): it
  is a pin, not a red-first test; the hash test failed before the copy.
  The frozen shell reader's own `shellWrites` is pinned the same way on the
  568 commands, and both frozen readers on the 1,090 string literals that
  read as commands in the guard's test files at 3c90919
  (`test/fixtures/guard-29-03-shell-corpus.json`): that also executes the
  copied code (coverage gate), with an assertion behind every line run.
- **S2R1-P2-2 — a hard cap on the line.** A command over 256 KB is refused
  unread, before any reader. Refused, not unchecked as suggested: `standard`
  lets an unchecked call run, so a padded `rm -rf .git; # <256 KB>` would pass
  where 29-03 refused it — unchecked there would break the monotonic rule.
  Measured at 250 KB on a handful of shapes (load 26): short segments 1.8 s,
  `node -e` 1.3 s, `psql -c` 1.4 s. *Corrected in series 2 round 2:* those
  shapes were not the worst; `rm a a a …` took 37 s and the reader was not
  linear end to end (see S2R2-P1-4).
- **S2R1-P2-3.** `python3 -c "print('rm -rf is bad')"` is unchecked: added to
  the accepted-noise row.
- **S2R1-P2-4.** tasks.md Result and Rollback Notes rewritten to the diff.
- **S2R1-P2-5 — latency, the reviewer's numbers.** In-process `decide()`:
  1.2 → 2 ms per call; the CLI cold: 193 → 209 ms. (Mine, round 4, load
  23–30: cold 7.3/9.3 → 14.5/14.4 ms per command, the hook process median
  301/310 → 334/351 ms.) The cost is the second reader.

### Series 2, review round 2 (fresh reviewer, bypass lens: FAIL, 4 P1 — the first a regression)

- **S2R2-P1-1 — the new pathspec rule reached 29-03's findings (regression).**
  `settle` quoted every dirty check's glob as `:(glob)`, the frozen reader's
  too: `git checkout -- '*.txt'` with only `sub/c.txt` modified went deny →
  unchecked (`:(glob)*.txt` does not cross `/`; git's `*.txt` does). Fixed
  structurally: 29-03's findings are judged by `bin/lib/destructive-judge-29-03.js`,
  3c90919's `gitNow`, `settle`, `destructiveReason`, `allowedByPolicy` and
  `judgeDestructive` (guard.js lines 789, 792–793, 1129–1275) copied between
  markers and pinned by hash; only `loadPolicy` is handed in. The new reader's
  findings go through guard.js's own judging. `strictestReading` returns the
  frozen decision as soon as it refuses (P1-4), else the strictest of the two.
  From reading to decision, nothing on 29-03's side is this story's code.
  `:(glob)` now applies only to a shell `rm`/`unlink` operand (the finding
  says `removal: "shell"`). The round's commands are recorded with 3c90919's
  decisions (`test/fixtures/guard-29-03-decisions-round2.json`, two fixtures:
  the reviewers' repo and one where only `sub/c.txt`, `sub/deep/e.txt` are
  modified); HEAD is never weaker, and both tests fail on the round-1 code.
- **S2R2-P1-2 — a git error read as clean.** `git status` that exits non-zero
  (a path outside the repository) returned no output and no issue, so
  `applies: false`. Now, on the new side: a non-zero exit is unchecked; paths
  outside the repository are left out of the pathspec list (git would fail on
  them, and they are not this repository's to lose); outside any repository
  the check does not apply; `{,}` yields no word.
- **S2R2-P1-3 — pathspec injection.** `rm a.txt ':!a.txt'` handed git an
  exclude. A shell `rm`/`unlink` word now goes to git as `:(literal)…`, a glob
  as `:(glob)…` (any leading `:` then literal). `git rm -f`'s operands are git's
  own pathspecs: handed as written, with no existence check first (`:/a.txt`,
  `':(top)a.txt'`, `':(glob)*.txt'` were skipped as missing files).
- **S2R2-P1-4 — the worst case.** The new reader no longer runs once 29-03's
  refused. The deadline is also read inside the operand loop of a removal.
  The 37 s was not a reader: `touchesPolicyFile` resolved each word on disk
  (`realpath`, `lstat`), twice (both readers list it). Memoized per call (a
  pure function of cwd, mode and word), it fell to 2.3 s. Worst case at the cap
  (255 KB, both readers, in-process, load 14), over 16 shapes: `git checkout --`
  with 43 000 words 6.4 s (two `git status` with every word, unchecked),
  `xargs` nested 4.5 s (both readers overflow the stack: unchecked), `rm` with
  65 000 globs 3.5 s, `rm {a,a,…}` 3.2 s, every other shape ≤ 2.3 s;
  `rm -rf .git; rm {a,a,…}` 0.2 s. The cap stays at 256 KB, now in UTF-8
  bytes. **Corrected in series 2 round 3:** "6.4 s worst case" was false — it
  held for those 16 shapes only. Many short segments under the cap cost far
  more (see the round-3 findings below: 98 s to over 120 s), as they did at
  3c90919. The whole-call time is out of this story's scope: story 29-06.
- **P2.** In the limits table: an overwrite of a modified file (`> a.txt`,
  `truncate -s0`, `cp`/`mv` onto it); `rm '*.txt'` and `rm \*.txt` refused as
  a glob (noise); padding a line past the 3 s budget makes it unchecked.

## Review findings

### Series 2 Round 3 — FAIL (differential + structural)

- [~] P1-1 whole-call time is unbounded: at ~262 KB, `git checkout -- sub/qN;`×7000
  → 105 s, `git zzN;`×11000 → 98 s (alias spawns), `cd dN && rm c.txt;`×11000 →
  >120 s (quadratic realpath/lstat) — the 60 s hook timeout (`.claude/settings.json`)
  lets the call through. Pre-existing at 3c90919 (no cap at all there) and on the
  frozen side, which this story must not edit. Coordinator decision: (a) the false
  "6.4 s worst case" claim is corrected here, in tasks.md, CHANGELOG.md and
  `docs/rules-and-limits.md` (a new row: the hook timeout can decide, story 29-06);
  (b) the fix is story 29-06 (`epics/epic-29-what-the-agent-cannot-fake/story-29-06-a-long-command-cannot-outrun-the-guard/story.md`),
  added to epic 29's index; (c) the whole-call time is **out of scope** for 29-04.
- [x] P1-2 `pathspecsIn` dropped a path outside the cwd's repository, so `settle`
  answered `applies: false`: from a linked worktree, `rm ../locked/sub/c.txt` and
  `rm /abs/…/locked/sub/c.txt` were allowed while `cd ../locked && rm sub/c.txt` was
  refused. Fixed: a shell removal's word is resolved on disk (its directory through
  `realpath`, up to the first glob component), its own repository is found from that
  directory, and `git status` runs there (one call per repository, the paths
  `:(literal)`/`:(glob)` relative to its top); git failing there is unchecked; a
  path in no repository is still no repository's to lose. Refusals name the files
  from the cwd (`../locked/sub/c.txt`). Test: `series 2 round 3: a path in another
  repository is checked in that repository` (linked-worktree layout, relative,
  absolute, glob, mixed, and a broken repository → not allowed); failed before.
- [x] P2 `indexHolds` answered `rm link/c.txt` (link → sub) from `lstat`, which
  follows the directory symlink: allowed. Now the fast path is skipped when the
  path's directory on disk is not its spelling (a symlinked directory, `..` through
  one) or the word starts with `~`; `git status` then checks the real path (the
  same `pathspecsIn` resolution), so it is refused. Test: `series 2 round 3: a path
  through a symlinked directory is not answered from the index` (`link/c.txt`,
  `link/deep/e.txt`, `link/*.txt`, a link into another repository); failed before.
- [x] P2 the frozen-judge pin test only rejected `function` outside the markers.
  It now lists the code lines outside them (comments and blank lines aside) and
  requires exactly `"use strict"`, the two requires, `let loadPolicy`, `use` and
  the export: any other line fails.
- [~] P2 `aliases…; rm sub/*.txt` (48 s) ends unchecked: the same whole-call cost as
  P1-1 (one alias lookup per segment); covered by story 29-06, not fixed here.

Measured after the fix (in-process `decide()`, fresh process, load ~12): `rm` with
15 000 words 0.4 → 0.7 s; 14 000 globs 1.3 → 1.8 s; 30 000 distinct directories
0.8 → 2.2 s (one `realpath` and one repository walk per distinct directory,
memoized per call; the cap on distinct directories is 29-06's).

### Series 2 Round 4 — FAIL (round-3 fixes and regressions) → split to 29-07

The last round of the second series: coordinator decision, split. The removal judged
where it lands is story 29-07
(`epics/epic-29-what-the-agent-cannot-fake/story-29-07-a-removal-is-judged-where-it-lands/story.md`).

- [~] split to 29-07 — P1 bin/lib/guard.js:1262 — a glob in a directory part skips the
  cross-repository removal check: from a linked worktree `rm ../?/src/a.js`,
  `rm ../[r]/src/a.js`, `rm $D/?/src/a.js`, `rm ../*/src/b.js` are allowed while
  `rm ../r/src/a.js` is denied (`onDisk` stops at the first glob component, `repoOf`
  finds no repo on the lexical path, `continue` → applies:false). → 29-07.
- [~] split to 29-07 — P2 bin/lib/destructive.js:690 — `rm linkdir/../sub0/s.txt`
  through a symlink to another repo is allowed (`..` resolved lexically). → 29-07.
- [~] split to 29-07 — P2 guard.js `indexHolds` — modified file in a nested
  (non-submodule) repo `rm nested/n.txt` allowed; `rm sm/*.txt` denied but
  `rm sm/s.txt` allowed. → 29-07.
- [x] P2 docs/rules-and-limits.md:139 still lists "through a symlinked directory" as
  not judged → fixed here: the row now says a path through a symlinked directory is
  judged in the repository it lands in, and a new row states what is not judged yet
  (a glob in a directory part of a removal into another repository, `..` after a
  symlinked directory, a modified file in a nested repository; story 29-07).
- [x] P2 test/guard-evasion.test.js:804 (added by this story) fails when the temp dir
  is deeper than `/tmp/x` (15 corpus commands move); `npm test` is red with the run's
  TMPDIR → fixed here: the recorded outputs hold paths relative to the repository
  (`../../.env`, `cd /tmp`), so that test builds its repository one level under
  `/tmp` (as when recorded) whatever TMPDIR is, and removes it after; the assertion is
  unchanged. Passes with TMPDIR=/tmp and with the run's deeper TMPDIR.

## Test Plan

`decide()` on throwaway repos for each criterion; the 29-03 Lens B list
re-asserted.

## Acceptance Traceability

See tasks.md (one line per criterion).

## Commands

```bash
npm test
```

### Series 3 Round 1 — FAIL (is what remains honestly bounded and safe to land?)

- [x] P1 test/guard-evasion.test.js:807 — `reviewerRepo(t, '/tmp')` pins the frozen-reader test to `/tmp`: on macOS `/tmp` → `/private/tmp` (realpath) = two levels deep, the exact depth failure (simulated: 0 pass); on Windows `'/tmp'` → `\tmp` on the runner's drive, likely ENOENT. Nothing skips it; CI runs macos-latest and windows-latest — fix: make the recorded digest independent of the repo's location (placeholders for the repo path and its parents, or a virtual repo path through `readerHost`); re-check under TMPDIR=/tmp, a deep TMPDIR and a `/private`-style symlink.
- [x] P2 the branch adds the three `*-29-03.js` files to the high-risk paths (policy tightened; verify warns "policy changed: .coding-flow/harness.json") — add a one-line `## Policy Change` section to the story.
- [x] P2 29-06's criteria are not runnable as written ("the hook's 60 s never decides", "latency within noise", "aliases…; rm sub/*.txt") — give a number and an exact command for each.

Held: frozen side byte-identical (hash pin), 40/40 under a deep TMPDIR on Linux, every ticked criterion has a test and none rests on 29-06/29-07, the 3 s budget and the 256 KB cap exist, CHANGELOG/rules-and-limits state the moved gaps.

Fixes (series 3 round 1):

- P1: no re-recording — both frozen-reader digest tests now show the readers a
  virtual repository, `/tmp/coding-flow-evasion-reviewer` (one level under `/tmp`,
  where the fixtures were recorded), whatever the real directory is. The host maps
  that path onto the real throwaway repository for `exists`/`isDirectory`; outside
  it only `/` and `/tmp` exist. The frozen files are loaded unchanged, as a fresh
  copy whose `require("path")` gets `path.posix`, under `process.platform` =
  `linux` for the call, so a Windows runner reads POSIX paths as the Linux
  recording did. The `/tmp` pin is gone. The fixtures are byte-identical, so the
  recorded digests are still 3c90919's. The test still detects a change: with the
  virtual repository one level deeper, it fails. Ran 40/40 with TMPDIR=/tmp, a
  5-level-deep scratchpad TMPDIR, and TMPDIR set to a symlink to a directory
  (the `/private/tmp` case). Windows was not run here.
- P2 policy: `## Policy Change` added to spec.md (high-risk paths tightened with
  the three frozen copies).
- P2 29-06: each criterion now has an exact `node -e` line generator, the CLI
  call, exit 2 and a time bound (20 s); the 48 s shape is written out (5 000
  aliases then `rm sub/*.txt`); "60 s never decides" is a deadline at most 30 s
  plus a slow-host test; "within noise" is a median at most 10 ms above develop's
  over 20 calls.

### Series 3 Round 2 — FAIL (security: can the claimed forms still evade?)

- [x] P1 destructive.js:1444 — a written-then-run file executed inside a nested shell or interpreter string is allowed (`echo 'rm -rf build' > x.sh && bash -c ./x.sh`, `… && sh -c 'bash x.sh'`, `… && bash -c '. ./x.sh'`, heredoc then `bash -c 'bash x.sh'`, `node -e 'require("child_process").execSync("sh x.sh")'`, `bash x.s?`): each nested reading starts a fresh `written` map — fix: pass the outer `written` map into nested readings; a glob/expansion that can name a written file → unchecked.
- [x] P1 destructive.js:960/927 — backslash-escaped spaces bypass the alias and interpreter readers (`git config alias.x !rm\ -rf\ build`, `git config alias.x \!git\ reset\ --hard`, `python3 -c import\ os\;os.system\(\"rm\ -rf\ build\"\)`) — fix: read the unquoted word as the quoted forms are.
- [x] P1 — code, alias value or SQL given as an expansion is allowed (`C='…rm -rf build…'; python3 -c "$C"`, `python3 -c "$(echo …)"`, `A='!rm -rf build'; git config alias.x "$A"`, `Q='DROP TABLE x'; psql -c "$Q"`), while `bash -c "$C"` is already unchecked — fix: an expansion in the code/alias/SQL position → unchecked.
- [x] P2 `os.execvp('git',[…,'reset','--hard'])`, DROP INDEX/VIEW/FUNCTION, UPDATE without WHERE — not claimed; list them in rules-and-limits.md as not read.

Fixed (series 3 round 3 implementer): one `written` map for the line and every nested reading (`readLine` takes `ctx.written`); a run file named by a glob or expansion on a line that wrote a file is unchecked; `shellWords` reads a segment by bash's rules (backslash outside quotes escapes the next character) for the interpreter and alias readers, every occurrence of the verb; `expandsRaw` marks an expansion outside single quotes in the code, alias-value or psql SQL position as unchecked. Tests: `series 3 round 2:` in test/guard-evasion.test.js (every reviewer example, failing before; 10 everyday `$VAR` commands allowed). P2 forms listed in rules-and-limits.md.

Held: literal forms of every ticked criterion; ~20 rm spellings, glued flags, env/absolute path prefixes, continuations, heredocs, cp/mv/ln of the written file, GIT_CONFIG_*, -f config, psql clusters; 30 everyday commands unchanged vs develop; frozen side byte-identical; the test's Module._load/platform override restored in finally and its digest test fails on a mutated frozen copy.

Note (orchestrator): 3 series, 10 rounds. The spec promises classes over an open input space ("a piece names a destructive verb"); each round finds a new spelling. This round's three fixes are rules, not spellings (shared `written` map, unquoted words read, expansions unchecked). If the next round finds another spelling of the same classes, the remaining claim is narrowed to the listed forms and the rest stated as limits (the open-promise rule of story 31-03), not chased.

### Series 3 Round 3 — FAIL (cost and honesty of the new rules: false denials)

- [x] P1 destructive.js `interpreterView` ~975 — any expansion anywhere in double-quoted interpreter code is unchecked: `python3 -c "print('$HOME')"`, `python3 -c "print(\"$HOME\")"` (allowed on develop); docs show only `-c "$C"` — fix: unchecked only when the code is (or starts with) an expansion, contains a command substitution `$(…)`/backticks, or uses a variable assigned on the same line; a plain env var inside a literal stays read as today. State the remaining gap (a variable set by an earlier call) as a limit.
- [x] P1 destructive.js `readPsql` ~536 — `psql -c "SELECT * FROM users WHERE id = $ID"` unchecked (allowed on develop) — same narrowing.
- [x] P1 destructive.js `readWrittenRun` ~1188 — a glob in the run word is unchecked after ANY write on the line (`echo hi > out.txt && bash scripts/*.sh`, `mkdir -p out && echo ok > out/a && bash ./scripts/ci-*.sh`, `npm run build > build.log && bash "$DEPLOY_SCRIPT"`) — fix: match a glob against the `written` keys; an expansion stays unchecked only if a script-like file was written on the line.
- [x] P2 reason texts: add a reason for "an expansion the guard cannot see" instead of "reads as a destructive command" / "runs a file it wrote".
- [x] P2 pin the costs: allowed tests for each everyday case above.
- [x] P2 cosmetic: `psql -c $'DROP TABLE x'` prints `'$DROP TABLE x'`.

Held: every new rule is pinned by a failing-on-removal test; 44/44; frozen side untouched; exec/timeout/nohup/sudo/bash --/-e/$(echo x.sh)/written x.py, `!sh -c`, `!$(printf …)`, `psql -c "$(printf …)"` all unchecked or refused; 78/86 everyday commands same as develop.
Round 4 is the last of series 3.

### Series 3 Round 4 — FAIL (did the narrowing reopen round 2? is the story coherent?) — docs only

- [x] P1 docs/rules-and-limits.md:85 — the "What it claims" sentence of *Destructive commands wait for the human* still says interpreter strings, two-step aliases and written-then-run scripts are out of reach, contradicting the same row's limits, the new table and CHANGELOG — fix: "partly read since 29-04 (see the table below); against an adversarial agent the protection is still the sandbox and permissions".
- [x] P2 code reading the environment at run time is allowed (`C=$(printf …); python3 -c "import os;os.system(os.environ['C'])"`) — add to the limits row (a value the text does not hold).
- [x] P2 the same-line-variable rule's everyday cost (`N=3; python3 -c "print($N * 2)"`, `T=users; psql -c "SELECT count(*) FROM $T"` now unchecked) — pin both with tests (expected unchecked) and name the cost in the row.
- [x] P2 CHANGELOG line 16 lists fewer triggers than the docs row (positional parameters, backticks).

Held: all 13 round-2 evasions still unchecked; 60 new variants unchecked except the run-time env read and two stated limits; 7 round-3 everyday examples pass; 27/30 everyday commands same as develop (3 = the documented same-line rule); frozen side unchanged; 100/100.
Series 3 ends at its cap with the code holding; next: series 4 round 1 after this docs fix.
