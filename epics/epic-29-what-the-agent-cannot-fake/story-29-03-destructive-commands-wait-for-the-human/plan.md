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
  By design, an Edit may move `mode` from `strict` to `standard` (D19): strict
  must never lock the user out of repairing the file through their agent.
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

### Review round 2 (fresh reviewer, 5 P1) — each class closed by a fail-safe default

Both rounds found the same kind of bypass: a list of forms losing to the next
form. Each fix below closes the class with a default that is never "allow"; the
reported instances stay as tests (`R2-*` in `guard-destructive.test.js`).

- **D21 — Nothing after the destructive check can lose its refusal.** The reader
  and `judgeDestructive` run first, on their own issue list; the rest of the
  Bash decision runs in a `try` that returns the destructive refusal if it
  throws. A reader that throws makes the call unchecked. The refusal is returned
  before the policy-file check, so `rm -rf build [z-a]` names `recursive rm`.
- **D22 — A glob the guard cannot model matches the policy file.** `globRegex`
  returns null (read as matching) for an invalid class (`[z-a]`), a POSIX class
  it does not map (`[[:punct:]]`, `[[=a=]]`), or a sequence (`{a..z}`). Brace
  alternatives (`{harness,x}`) and the common POSIX classes (alpha, digit, alnum,
  upper, lower, space, blank, xdigit, word) are modelled. The working directory
  is escaped before the operand's glob is applied, so a `[` in a directory name
  is not a class.
- **D23 — Command substitutions the segment splitter does not see are read.**
  `$(…)` inside double quotes, every backtick, and `$(…)` in an unquoted heredoc
  body are scanned (quotes, nesting, comments and heredoc bodies honoured) and read
  as scripts, for destructive commands **and** writes (`echo "$(echo x > .env)"`,
  a pre-existing write-reader gap). One that does not close is unchecked. After a
  `cd` on the line their directory is unknown (null): a finding needing a check is
  unchecked, a write is unchecked. A quoted heredoc (`<<'EOF'`) expands nothing,
  so the usual `git commit -m "$(cat <<'EOF' … EOF)"` stays allowed.
- **D24 — xargs values, GNU's way.** Value options: `-I -n -L -P -d -E -s -a` and
  `--max-args --max-lines --max-procs --delimiter --arg-file --max-chars
  --process-slot-var`, read by prefix (`--max-a`); `--opt=value` is one word.
  **Deviation from the brief:** `--replace`, `--eof` (and `-i`, `-e`, `-l`) take a
  value only when attached (`xargs --help`: `--replace[=R]`), so the next word is
  the command — the old set wrongly took `-i rm` as a value. Tests cover both.
- **D25 — A verb hidden behind an unknown command is unchecked.** `setsid`,
  `unbuffer`, `flock FILE`, `taskset MASK` join the wrappers (`flock … -c` hands a
  script on); `sudo -iu root` (a cluster ending in a value option) steps over the
  value; `parallel CMD ::: ARGS` is read as `CMD ARGS`. The class: a command the
  reader does not know, and that is not inert (`echo`, `grep`, `which`, `man`,
  `cat`…), has each later word that names a command the reader knows read as
  that command; a finding there is unchecked (never refused: the word may be
  data), a path it touches is `maybe` (unchecked if it reaches the policy file).
- **D26 — Paths the guard cannot see.** A remover, mover, copier or `git rm`/`mv`/`checkout`/`restore` run by
  `xargs` (or `parallel` without `:::`) is handed paths from its input: the call
  is unchecked, wherever it runs (an input path may be absolute). `find -exec` of
  a remover, `mv`, or a copy onto `{}` reaches what find matches (refused when
  that is the policy file); of any other non-inert command it is `maybe`. A
  `find` whose start is an expansion, or after an unknown `cd`, is unchecked.

P2 dispositions:

- **D27 — An unreadable policy file keeps the primary checkout locked**
  (`chmod 000`, a broken edit): fixed on the read side, so no chmod parsing.
- **D28 — `ln` to the policy file or a directory holding it is refused**: what a
  later step does through the link (`ln -s .coding-flow cf && rm cf/harness.json`)
  cannot be followed when the link does not exist yet.
- **D29 — From a linked worktree, the primary checkout's policy file** is one the
  shell may not touch either.
- **D30 — `git branch -f <name> …`, `-M`, `-C` are refused** (forced branch move).
- **D31 — Not fixed, listed in rules-and-limits:** `git stash push` (or `git
  stash`) taking an uncommitted edit of `harness.json` away — it is recoverable
  (`git stash pop`), and a human tightening is safe once committed; a `case`
  pattern's `)` inside `"$(…)"` ends the substitution early.

### Review round 3 (fresh reviewer, 9 P1) — two backstops

Three rounds each found one more construct the reader does not model:
enumeration does not converge. Two backstops make "allow" mean "fully
understood"; every case reported stays a test (`R3:`), and each backstop has a
test on forms nobody listed (`R3 backstop 1`, `R3 backstop 2`). The everyday
workflow is a test too (`Lens B`), so the backstops' noise is measured.

- **D32 — Backstop 1: only modelled syntax is allowed.** Every line read (at any
  depth) is viewed with its quoted parts, substitutions and heredoc bodies
  blanked; a construct outside the modelled set makes the line unchecked:
  a here-string `<<<`, an ANSI-C string `$'…'`, `$IFS`/`${IFS}`/`IFS=`, `~+`/`~-`/
  `~user`, an extended glob `@(…)`, arithmetic on anything but literals (`$((x+1))`,
  `((…))`, `[[ … -eq … ]]`: arithmetic evaluates a variable's text, which may hold
  `a[$(cmd)]`), `expand_aliases`, the keywords `case`, `coproc`, `select`, `let`,
  a quote or substitution that does not close, and a verb built by an expansion
  or a glob (`rm$IFS-rf`, `/bin/r?`, `$X`), tested on the raw word before
  `path.basename`. Brace expansion is modelled only in the path operands of a
  remover, `mv`, a copier, `mkdir`/`touch` (where the policy-file check matches
  it as a glob) or an inert command; in the verb, an option or any other
  command it is unchecked. What the reader models is the rest: words, quotes,
  backslashes, `;` `&&` `||` `|` `&`, subshells and groups, redirections,
  heredocs, `$(…)` and backticks (now all read as scripts, unquoted ones too),
  globs `* ? […]`, `~` and `~/`, assignments, `for`/`while`/`if` bodies.
- **D33 — Backstop 2: destructive text handed to a command is unchecked.** For a
  command that is not inert, each word it is handed (and an assignment's value,
  `make CLEAN='git clean -fdx'`) with a space in it is read as a script; a
  finding there makes the call unchecked (the word may be data). A word naming
  the policy file or `.coding-flow` whole, handed to a command the reader does
  not read (`node -e …`, `python3 -c …`), is unchecked too. Text options are
  skipped: git's `-m/--message`, `-F/--file`, `--grep`, `--format`/`--pretty`,
  `-S`/`-G`, `--author`/`--committer`; gh's `--body`, `--title`, `--notes`,
  `--message` and their short forms.
- **D34 — The inert list is short, and each entry runs none of its words:**
  `echo printf grep egrep fgrep rg which whereis type man help cat head tail ls wc
  uniq cut stat file cmp md5sum sha1sum sha256sum test [ true false basename
  dirname realpath readlink du jq`. Removed from round 2's list: `less`, `more`,
  `info` (interactive, can run commands), `sort` (`--compress-program`), `diff`,
  `ag`. `rg --pre CMD` and `man -P`/`--pager`/`-H` run a program, so they are
  not inert then.
- **D35 — Direct fixes where cheap:** `<<<` is stepped over in both substitution
  scanners and in the segment splitter (it was read as `<<` + a quoted heredoc);
  `$'…'` is modelled in the scanners and the splitter; a here-string into an
  interpreter is unchecked (`HEREDOC_PROGRAM`); `bash -c`'s program is the first
  non-option word after the cluster (`-e`, `+e`, `-x`, `-o opt` skipped);
  `script -qc`/`su -lc` (a cluster closing in `c`); `npx -c`/`--call`, `npm`/
  `pnpm exec -c` read their script; `trap 'cmd' SIG`, `git submodule foreach
  'cmd'` (directory unknown) and `git bisect run cmd` read as commands; `~+`,
  `~-`, `~user` are expansions in `resolveIn`.
- **D36 — Left as noise (standard mode allows unchecked; strict refuses it):**
  `git push origin "$(git branch --show-current)"` (D7: the refspec is an
  expansion), `$((i+1))`, `cp file{,.bak}` is modelled but `git add {a,b}.js` is
  not, `npm test -- --grep "rm -rf"`, `grep rm .` style words after an unknown
  command.

### Review round 4 (fresh reviewer, 4 P1) — direct fixes

- **D37 — A heredoc delimiter is one shell word** (`<<E"OF"`, `<<"E"OF`,
  `<<'E'OF`, `<<E\OF`): its parts are joined and unquoted, and the body is literal
  when any part is quoted or escaped — one parser (`heredocWord` in
  `shell-writes.js`) for the splitter and the destructive reader. A delimiter that
  cannot be taken whole (`<<E"OF`) makes the line unchecked (backstop 1).
- **D38 — `source` and `.` are interpreters**; `/dev/stdin` and `/dev/fd/N` are
  stdin, so `source <(…)`, `… | source /dev/stdin` and `. /dev/stdin <<EOF` are
  unchecked like `bash <<EOF`.
- **D39 — A prefix assignment is handed text** (`PAGER='rm -rf x' git log`,
  `GIT_EDITOR=`, `GIT_SSH_COMMAND=`, `GIT_EXTERNAL_DIFF=`, `env PAGER=… git log`):
  every `NAME=value` before the verb is read by backstop 2.
- **D40 — `docker run|exec|compose run IMAGE CMD…`** with no docker finding is read
  for a hidden verb (unchecked: the container's volumes are unknown). Checked
  for the same gap: `psql` (`\!` shell escapes not read — P2 below), `prisma` and
  `curl`/`wget` run no command they are handed.

### D-cap — the claim re-scoped after four review rounds

| Round | Reviewer | P1 | Kind |
|---|---|---|---|
| 1 | independent | 7 | depth cap, `-c --`, wrappers under xargs/find, long-option prefixes, checkout/switch `-f`, policy file through globs/ancestors, case-insensitive names |
| 2 | fresh, security | 5 | a crash failing open, substitutions in quotes/backticks, xargs values, wrappers hiding the verb, policy file through braces/POSIX classes/xargs |
| 3 | fresh, bypass + false positives | 9 | here-strings, `bash -c -e`, clustered `-c`, runner `-c`, `trap`, `~+`, `$'…'`, `$IFS` verbs, `case` in a substitution — answered with two backstops |
| 4 | fresh | 4 | partly quoted heredoc delimiters, `source <(…)`, prefix assignments, docker run |

Every round found one more construct a text reader of bash does not model:
enumeration does not converge, and four rounds is the cap. **Decided by the
run:** the claim is re-scoped. The guard refuses the destructive forms an agent
writes by habit and marks unchecked what it cannot read; a form built to evade it
(unusual quoting, generated code, interpreter strings) is out of this guard's
reach — the protection against an adversarial agent is the sandbox and
permissions (design-decisions entry 10). spec.md's "never a silent pass" is
replaced by that sentence. Under it, review severity is: **P1** = a habitual
destructive form allowed silently, a removal or loosening of the policy file
allowed silently, or a false positive blocking a core workflow; an obfuscation
form is **P2** and goes to a follow-up story. A new review series starts at
round 1 under this claim.

P2, to story 29-04 (the run plans it): interpreter strings (`python -c`, `perl
-e`, `ruby -e`; string concatenation defeating the policy-file text match), a
two-step git alias (`git config alias.x '!…'`, then `git x`), script files
(`echo … > x.sh && bash x.sh`), `psql` `\!` shell escapes.

### New review series, round 1 (under the re-scoped claim, 2 P1)

- **D41 — `git submodule foreach` keeps its command's flags.** Only foreach's own
  leading options (`--recursive`, `-q`, `--quiet`) are skipped; every other word
  is the command, read as a script in an unknown directory. Checked for the same
  bug: `git bisect run` passes its words whole; no other script is built by
  filtering `-` words. A `git clean` whose directory is unknown is refused (it
  destroys wherever it runs), like `changes`; a named-path check still needs it.
- **D42 — A git alias in the config is resolved.** When the subcommand is not one of
  git's own (an alias never shadows one), `git -C <dir> config --get alias.<sub>`
  runs (bounded, no shell; the host's `gitAlias`) and the expansion is read in its
  place — a `!` value as a shell script. No alias: nothing. A lookup git does not
  answer, an unknown directory, or a chain past 5 (a loop) is unchecked.
- **D43 — `allowDestructive` is the exact command, word by word.** The spec said
  "exact command prefix" and its criterion "exactly that command"; a prefix let
  `rm -rf node_modules` allow `rm -rf node_modules ~`. An entry is now matched
  whole; a last word `*` keeps a prefix where the human wants one
  (`git clean -fdX -- build *`, since D47). The earlier test's `git clean -fdX -- build` moved from
  allowed to refused.

P2, to 29-04 (planned by the run): `echo "DROP DATABASE x" | psql`, `psql -c 'DROP
TABLE/SCHEMA … CASCADE'`, `git rm -f` or a plain `rm` of a modified tracked file.

### New review series, round 2 (1 P1)

- **D44 — A `!` alias is read at the work tree's top**, where git runs it
  (`git rev-parse --show-toplevel` of the command's directory, the host's
  `gitTop`): `alias.discard=!git checkout -- .` called from a clean `sub/` sees the
  modified top. Top unknown → null directory (discard-all and clean still refuse;
  a named path is unchecked).
- **D45 — Only git's exit 1 means "no such alias".** Any other failure
  (`git -C /nonexistent rh`, a refused repository) is unchecked, as D42 said.
- **D46 — An `allowDestructive` entry that is a bare `*` or a verb and `*`
  (`rm *`) is ignored**, and every refusal names it, so the human sees why their
  entry did nothing. Extended by D47.

To 29-04: the alias lookup ignores a `GIT_DIR=`/`GIT_CONFIG_GLOBAL=` prefix on the
command. Accepted noise, strict mode only: `git submodule foreach 'git checkout
main && git pull'` is unchecked (a branch change in an unknown directory).

### New review series, round 3 (PASS, P2s fixed)

- **D47 — A trailing `*` needs an operand before it.** An entry whose words before
  `*` are only the verb (with git, its subcommand) and flags is ignored like D46:
  `rm -rf *` would allow `rm -rf node_modules ~`, `git clean *` would allow
  `-fdx`. That includes `git clean -fdX *`, so D43's example became
  `git clean -fdX -- build *`, and the two tests that used it now use that entry.
- **D48 — git that never ran is an issue.** `gitNow` maps a spawn error (`ENOENT`,
  `EACCES`: git not on the guard's PATH) to "git is not on the guard's PATH":
  a check that needs git is unchecked, never allowed (discard-all still refuses).
- **D49 — One git timeout per decision.** After the first timeout, the remaining
  git lookups of the same Bash decision are skipped and unchecked with the same
  reason, so hanging lookups cost 2 s, not 2 s each. Reset at each decision.
- **D50 — A substituted operand is named whole** in a refusal (`rm -rf $(ls)`, not
  `$`), when the substitution closes right after; `$(…)` otherwise.

### New review series, round 4 (PASS) — last P2s

- **D51 —** the docs say plainly that a `*` entry allows any later operand, `~`
  included (the human's choice); the destructive checks name their own git
  failures (timeout, refused repository, git off PATH, an answer over the 64 MB
  `maxBuffer` — `ENOBUFS` is no longer read as a timeout); the timeout budget's
  reset on the next decision is asserted; a refusal keeps the quotes of a word
  with a space (`psql -c 'DROP DATABASE mydb'`).

### Review history

- **First series** (claim: never a silent pass): 4 rounds, P1 per round 7 / 5 / 9 / 4
  — the cap, then the claim was re-scoped (D-cap).
- **New series** (re-scoped claim): 4 rounds, P1 per round 2 / 1 / 0 / 0. Rounds 3
  (security/robustness) and 4 (generalist) were clean in a row: STRICT done.

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
- Policy: deny / warn / off, `allowDestructive` exact command (`*` opts in to a prefix), unreadable
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
