# Story 05-03 — Follow the shell: `cd`, links, `git checkout --`, inline code, variables

## User Value

The common shell shapes an agent uses to write a file are resolved like the
shell would, and the shapes the guard cannot resolve are reported as
`unchecked` rather than silently allowed.

## Requirements

`shellWriteTargets` (or its replacement) walks the command segment by segment,
keeping a **current directory** that starts at the hook cwd:

- `cd <dir>`, `pushd <dir>` update it for the following segments (`&&`, `;`,
  newline). `cd` with no argument or `cd ~` → `$HOME`. `cd -`, `popd`, or a
  `cd` target containing `$`/backticks → the directory becomes unknown, and
  every later write target in that command is `unchecked`.
- Subshells `( … )` restore the directory afterwards (best effort: a `cd`
  inside parentheses does not leak).
- Each target is resolved against the current directory, then through 05-01's
  resolver.
- `ln [-s] [-f] <src> <dest>`: besides `<dest>` (today), creating a link
  **whose source resolves to a protected path** is denied ("aliasing a
  protected file").
- `git checkout <ref> -- <paths…>`, `git restore [--source …] <paths…>`,
  `git show <ref>:<path> > x` (already a redirection): the listed paths are
  write targets.
- `python[3] -c`, `node -e|--eval`, `perl -e`, `ruby -e`, `deno eval`,
  `bun -e`: when the inline code contains a string literal that, resolved
  against the current directory, matches a blocked path → deny. Otherwise
  allow (we cannot read what it does; no false alarm on every `node -e`).
- A redirection or destination argument containing `$`, backticks or `$(` →
  `unchecked` with the reason "write target depends on shell expansion".
- `bash|sh|zsh <file>` and `./script`: unchanged (allow); listed in 05-05's
  limits.

## Acceptance Criteria

- [x] `cd sub && echo A=1 > ../.env` → deny.
- [x] `cd /tmp && echo A=1 > .env` → allow (outside every base).
- [x] `(cd sub && touch x) && echo A=1 > .env` → deny (root `.env`).
- [x] `cd "$DIR" && echo A=1 > .env` → unchecked.
- [x] `ln -s .env x` → deny; `ln -s README.md x` → allow.
- [x] `git checkout stash@{0} -- .env` → deny; `git restore --source HEAD~1 src/a.js` → allow.
- [x] `python3 -c "open('.env','w').write('A')"` → deny;
      `node -e "console.log(1)"` → allow.
- [x] `F=.env; echo A=1 > $F` → unchecked.
- [x] All cases already denied before this story stay denied (tee, cp, mv,
      `sed -i`, `dd of=`, `>`/`>>`, `2>`).

## Edge Cases

- **False positives are the main risk**: `echo "> .env"` inside quotes is not
  a redirection (keep today's handling); heredocs (`cat <<EOF > file`) keep
  the redirection target; `2>&1` stays ignored.
- **Concatenated literals** (`'.e'+'nv'`) are not detected — documented
  limit, not a bug.

## Status: done

## Result

`shellWrites` walks a command segment by segment (quote-, group- and heredoc-aware) with the directory it runs in: `cd`/`pushd`/`popd`, `( … )` restoring it, `time|command|builtin|env|sudo` wrappers. Added: `ln`/`cp -s|-l` aliasing of a protected source (also read from the link's directory), `git checkout|restore` paths (with or without `--`, `git -C`, `--pathspec-from-file` = unchecked), inline `python|node|bun|perl|ruby|deno` string literals, and `unchecked` for `$VAR`/`$(…)`/backtick/`~user` targets or an unknown directory. `shellWriteTargets` stays as a plain-list wrapper.

Deviations: after an unknown `cd`, an **absolute** target is still judged (stricter than "every later target unchecked"), and a known absolute `cd` makes the directory known again.

Known limits (for 05-05): a `cd` is assumed to succeed (`cd nonexistent && …`); a `cd` in a pipeline or backgrounded is ignored; `:/path` pathspec magic; `xargs sh -c "…"` and other wrappers that build a command from input (`bash -c "…"` and `eval` are read as a command of its own), `'.e'+'nv'`; an inline literal that merely *names* a protected file (`node -e "console.log('.env')"`) is refused — it cannot be told from a write (so is a bare word such as `w` or `A` when a blocked path has that name).

Review follow-up: directory destinations (`mv X .`, `cp -t DIR`) resolve to `DIR/<source name>`; `curl -o`/`wget -O` are read; `< input` operands are no longer writes. Not read: `tar -x`, `unzip`, `curl -O` (remote name).

Also limits: `patch` and other in-place editors (only `sed`, `perl -i`, `awk -i inplace`, `truncate` are read); `cd a || cd b` keeps only the first branch's directory afterwards.

Review follow-up 2: quote/backslash splicing in a word is removed before resolving; unquoted `* ? [ {` in a target is `unchecked`. More limits (for 05-05): `xargs cp {} .env`, `git apply`, `git stash pop` write files and are not read.

Rollback: revert the commit; `shellWriteTargets` kept its signature.

Review follow-up 3: a redirection target is one word (quoted parts glued to bare characters), `-t` inside a flag cluster is read, `sponge` is a write, backslash-newline is joined. More limit (for 05-05): `find … -exec cp {} .env \;` writes and is not read (same family as `xargs`).

## Known limits (consolidated, for 05-05)

- A `cd` is assumed to succeed; a `cd` in a pipeline or backgrounded is ignored; `cd a || cd b` keeps only the first branch.
- Commands that build a command from input: `xargs`, `find -exec`, `git apply`, `git stash pop`, `tar -x`, `unzip`, `curl -O`, `patch` without a FILE.
- `:/path` pathspec magic; concatenated literals (`'.e'+'nv'`).
- An inline literal that merely names a protected file is refused (cannot be told from a write).
- Not followed: `env -C DIR` / `env --chdir=DIR` (the command runs from DIR); wrappers outside the known list (`stdbuf`, `busybox`, …) hide the verb; a digit in a perl `-i` cluster (`perl -0pi`); copying a directory's contents (`cp -r src/. .`, `rsync -a src/ .`) names no file and is allowed.

Review follow-up 4: `node -pe`, `perl -E` and `deno eval --ext=ts …` are read as inline code; `sed -i` with its script in `-e`/`--expression`/`-f` edits every operand; a shell or interpreter reading its program from a pipe (`curl … | sh`, `cat <<EOF | bash`) is `unchecked` (a shell limit, like the heredoc case).

Review follow-up 5: `sh -s ARGS` (stdin whatever follows its options), `|&` (a pipe, not a background job) and `bash <(…)` (process substitution) are `unchecked` as shell limits, like a piped program. Under `mode: strict` these are refused.
