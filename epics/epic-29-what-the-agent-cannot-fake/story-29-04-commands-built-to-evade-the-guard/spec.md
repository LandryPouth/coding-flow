# Story 29-04 — Commands built to evade the guard

## User Value

29-03's guard refuses the destructive commands an agent writes by habit and
marks unchecked what it cannot read. Its four review rounds also found forms
that hide a destructive command inside something the guard does not read:
code strings handed to an interpreter, a git alias defined in one call and run
in the next, a script file written then executed. This story closes the ones
that are cheap to read, and states the rest as limits, so the maintainer knows
exactly where the guard stops and where the sandbox must take over.

## Requirements

- Interpreter code (`python -c`, `python3 -c`, `node -e`, `perl -e`,
  `ruby -e`, `php -r`): extract the string literals of the code and read each
  as a script; a destructive finding makes the call unchecked. A call whose
  code builds a path or command from pieces (concatenation, format) that the
  extraction cannot join is unchecked when the policy file's name, or a
  destructive verb, appears in any piece.
- A git alias whose value runs a shell (`!…`) set by `git config` (any scope)
  is read as a script when it is set; a destructive value makes the
  `git config` call unchecked.
- A script file written and executed in the same command line
  (`echo … > x.sh && bash x.sh`, `cat > x <<EOF … EOF; sh x`) is read through
  the text written to it; otherwise executing a file the line just wrote is
  unchecked.
- Data loss through SQL beyond `DROP DATABASE`, found by 29-03's reviews:
  `psql -c 'DROP TABLE …'` / `'DROP SCHEMA … CASCADE'` / `TRUNCATE`, and SQL
  piped into psql (`echo "DROP DATABASE x" | psql`): refused when read,
  unchecked when the SQL comes from stdin the guard cannot see.
- A tracked file with uncommitted changes removed by `git rm -f` or plain
  `rm`: refused like `git checkout -- <file>` on a modified file.
- `docs/rules-and-limits.md` lists, in one table, every form the guard does
  not read (from 29-03's D9 and this story), each with the protection that
  covers it instead (sandbox, permissions, review).

## Acceptance Criteria

- [x] Given `python3 -c 'import os; os.system("rm -rf build")'`, then the
      call is unchecked; given `python3 -c 'print(1)'`, it is allowed.
- [x] Given `python3 -c 'os.remove("harness" ".json")'` run in
      `.coding-flow/`, then the call is unchecked.
- [x] Given `git config alias.x '!rm -rf build'`, then the call is
      unchecked; `git config alias.st status` is allowed.
- [x] Given `echo 'rm -rf build' > x.sh && bash x.sh`, then the call is
      unchecked.
- [x] The rules-and-limits table names each unread form and its cover, and
      a test checks that every form listed in 29-03's D9 appears in it.
- [x] Given `psql -c 'DROP SCHEMA app CASCADE'`, then it is refused; given
      `echo "DROP DATABASE x" | psql`, then it is unchecked.
- [x] Given a tracked file with uncommitted changes, then `git rm -f` of it
      and `rm` of it are refused; on a clean file they are allowed.
- [x] 29-03's everyday-command test (Lens B) still passes unchanged.

## Edge Cases

- An interpreter reading code from a file (`python script.py`) is not read;
  that stays a stated limit, like `npm run`.

## Out of Scope

- Executing or sandboxing anything: the guard reads text, it never runs it.
