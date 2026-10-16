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

- [ ] `cd sub && echo A=1 > ../.env` → deny.
- [ ] `cd /tmp && echo A=1 > .env` → allow (outside every base).
- [ ] `(cd sub && touch x) && echo A=1 > .env` → deny (root `.env`).
- [ ] `cd "$DIR" && echo A=1 > .env` → unchecked.
- [ ] `ln -s .env x` → deny; `ln -s README.md x` → allow.
- [ ] `git checkout stash@{0} -- .env` → deny; `git restore --source HEAD~1 src/a.js` → allow.
- [ ] `python3 -c "open('.env','w').write('A')"` → deny;
      `node -e "console.log(1)"` → allow.
- [ ] `F=.env; echo A=1 > $F` → unchecked.
- [ ] All cases already denied before this story stay denied (tee, cp, mv,
      `sed -i`, `dd of=`, `>`/`>>`, `2>`).

## Edge Cases

- **False positives are the main risk**: `echo "> .env"` inside quotes is not
  a redirection (keep today's handling); heredocs (`cat <<EOF > file`) keep
  the redirection target; `2>&1` stays ignored.
- **Concatenated literals** (`'.e'+'nv'`) are not detected — documented
  limit, not a bug.
