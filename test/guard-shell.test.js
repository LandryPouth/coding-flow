'use strict';

// The shell shapes an agent uses to write a file are resolved the way the shell
// would (cd, subshells, links, git, inline code); what cannot be resolved is
// `unchecked`, never silently allowed.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { decide, shellWriteTargets } = require('../bin/lib/guard');

function project(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-shell-')));
  fs.mkdirSync(path.join(dir, '.coding-flow'));
  fs.mkdirSync(path.join(dir, 'sub'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const run = (dir, command) => decide({ tool_name: 'Bash', tool_input: { command }, cwd: dir }, dir).decision;

function expectAll(t, expected, commands) {
  const dir = project(t);
  for (const command of commands) {
    assert.equal(run(dir, command), expected, `${expected}: ${command}`);
  }
}

test('cd moves where a later relative write lands', (t) => {
  expectAll(t, 'deny', [
    'cd sub && echo A=1 > ../.env',
    'pushd sub; echo A=1 > ../.env',
    '(cd sub && touch x) && echo A=1 > .env',
    'cd sub\ncd .. && echo A=1 > .env',
  ]);
});

test('a cd that leaves the project makes the same name a different file', (t) => {
  expectAll(t, 'allow', ['cd /tmp && echo A=1 > .env', '(cd sub && touch x) && echo A=1 > notes.txt']);
});

test('a cd the guard cannot follow makes later relative writes unchecked', (t) => {
  expectAll(t, 'unchecked', ['cd "$DIR" && echo A=1 > .env', 'cd - && echo A=1 > .env', 'cd sub; popd; echo A=1 > .env']);
});

test('an absolute target is still judged after an unknown cd', (t) => {
  const dir = project(t);
  assert.equal(run(dir, `cd "$DIR" && echo A=1 > ${path.join(dir, '.env')}`), 'deny');
});

test('a write target decided by a variable or substitution is unchecked', (t) => {
  expectAll(t, 'unchecked', ['F=.env; echo A=1 > $F', 'echo A=1 > "$(mktemp)"', 'cp a.txt $DEST', 'echo hi | tee `pwd`/x']);
});

test('a link whose source is protected is refused; any other link is fine', (t) => {
  const dir = project(t);
  assert.equal(run(dir, 'ln -s .env x'), 'deny');
  assert.match(decide({ tool_name: 'Bash', tool_input: { command: 'ln -s .env x' }, cwd: dir }, dir).reason, /alias/);
  assert.equal(run(dir, 'ln -s README.md x'), 'allow');
  assert.equal(run(dir, 'ln -s README.md .env'), 'deny', 'the destination is still checked');
});

test('git checkout -- and git restore name the files they overwrite', (t) => {
  const dir = project(t);
  assert.equal(run(dir, 'git checkout stash@{0} -- .env'), 'deny');
  assert.equal(run(dir, 'git restore --source HEAD~1 .env'), 'deny');
  assert.equal(run(dir, 'git restore --source HEAD~1 src/a.js'), 'allow');
  assert.equal(run(dir, 'git restore --staged .env'), 'allow', 'unstaging touches the index, not the file');
  assert.equal(run(dir, 'git checkout main'), 'allow');
});

test('inline interpreter code that names a protected path is refused', (t) => {
  const dir = project(t);
  for (const command of [
    `python3 -c "open('.env','w').write('A')"`,
    `node -e 'require("fs").writeFileSync(".env","x")'`,
    `perl -e 'open(F, ">", ".env")'`,
    `ruby -e "File.write('.env', 'x')"`,
    `cd sub && python -c "open('../.env','w')"`,
  ]) {
    assert.equal(run(dir, command), 'deny', command);
  }
  assert.equal(run(dir, 'node -e "console.log(1)"'), 'allow');
  assert.equal(run(dir, `python3 -c "print('hello')"`), 'allow');
});

test('what was refused before is still refused', (t) => {
  expectAll(t, 'deny', [
    'echo x > .env',
    'echo x >> .env',
    'echo x 2> .env',
    'echo x | tee .env',
    'cp /tmp/a .env.production',
    'mv /tmp/a .env',
    "sed -i 's/a/b/' .env",
    'dd if=/dev/zero of=id_rsa',
    "cat > .env <<'EOF'\nA=1\nEOF",
  ]);
});

test('quoted text, descriptor duplication and a heredoc are not mistaken for writes', (t) => {
  expectAll(t, 'allow', [
    'echo "> .env"',
    'npm test > /tmp/out.log 2>&1',
    'echo "a; cd /tmp" && echo hi > notes.txt',
    'cat <<EOF > notes.txt\nhello\nEOF',
    'git commit -m "wip"',
  ]);
});

test('a group closes after its own last command, not before it', (t) => {
  expectAll(t, 'deny', [
    'cd sub; (cd ..; echo A=1 > .env)',
    '(cd sub); echo A=1 > .env',
    '( cd sub ) && echo A=1 > .env',
    'echo a | (cd sub && tee ../.env)',
    'echo $(cd sub && echo A=1 > ../.env)',
  ]);
});

test('a substitution in a cd target makes the directory unknown', (t) => {
  expectAll(t, 'unchecked', ['cd $(echo sub) && echo a > ../.env', 'cd sub; cd $(echo ..); echo a > .env', 'cd ~someone && echo a > .env']);
});

test('a cd in a pipeline or after a failed cd does not move the shell', (t) => {
  expectAll(t, 'deny', ['echo hi | cd sub; echo A=1 > .env', 'cd sub || echo A=1 > .env', 'cd sub & echo A=1 > .env']);
});

test('what follows `cd x || …` runs from x: the cd worked', (t) => {
  expectAll(t, 'deny', ['cd sub || exit; echo A=1 > ../.env', 'cd sub || true; echo A=1 > ../.env', 'cd sub || exit 1\necho A=1 > ../.env', 'cd sub || cd ..; echo A=1 > ../.env']);
  expectAll(t, 'allow', ['cd sub || exit; echo A=1 > notes.txt', 'cd sub || cd ..; echo A=1 > .env']);
});

test('bash -c reads its script from the current directory', (t) => {
  expectAll(t, 'deny', ['bash -c "echo A=1 > .env"', "sh -c 'cd sub && echo A=1 > ../.env'", 'cd sub && bash -c "echo A=1 > ../.env"']);
  expectAll(t, 'allow', ['bash -c "echo hi"', 'bash -c "cd sub && echo A=1 > notes.txt"']);
  expectAll(t, 'unchecked', ['bash -c "echo A=1 > $F"', 'cd "$D" && bash -c "echo A=1 > .env"']);
});

test('an escaped quote inside a -c script does not hide the write', (t) => {
  expectAll(t, 'deny', ['bash -c "echo \\"x\\" > .env"', 'sh -c "echo > \\".env\\""']);
});

test('eval reads its string as a command', (t) => {
  expectAll(t, 'deny', ['eval "echo A=1 > .env"', 'cd sub && eval "echo A=1 > ../.env"']);
  expectAll(t, 'allow', ['eval "echo hi"']);
});

test('an unknown directory does not make a harmless -c script unchecked', (t) => {
  expectAll(t, 'allow', ['cd "$D" && bash -c "echo hi"']);
});

test('a heredoc body is data: its quotes and punctuation neither hide nor invent a command', (t) => {
  const dir = project(t);
  assert.equal(run(dir, "cd sub\ncat <<EOF\ndon't (x) | y\nEOF\ncd ..\necho A=1 > .env"), 'deny');
  assert.equal(run(dir, 'cat <<EOF > notes.txt\necho A=1 > .env\nEOF'), 'allow', 'a redirection inside the body writes nothing');
});

test('git checkout without --, git -C, and a pathspec file', (t) => {
  const dir = project(t);
  assert.equal(run(dir, 'git checkout stash@{0} .env'), 'deny');
  assert.equal(run(dir, 'git checkout HEAD -- .env'), 'deny');
  assert.equal(run(dir, 'git -C sub restore ../.env'), 'deny');
  assert.equal(run(dir, 'git -C sub restore .env'), 'allow', 'sub/.env is not the root .env');
  assert.equal(run(dir, 'git restore --pathspec-from-file=list'), 'unchecked');
  assert.equal(run(dir, 'git checkout -b feature'), 'allow');
});

test('links: a relative source is read from the link\'s directory, cp -s aliases too', (t) => {
  const dir = project(t);
  assert.equal(run(dir, 'ln -s ../.env sub/x'), 'deny');
  assert.equal(run(dir, 'cp -s .env x'), 'deny');
  assert.equal(run(dir, 'cp -l .env x'), 'deny');
  assert.equal(run(dir, 'ln -s .env'), 'deny');
  assert.equal(run(dir, 'cp README.md notes.md'), 'allow');
});

test('wrappers and flag spellings do not hide the verb', (t) => {
  const dir = project(t);
  for (const command of [
    'time cd sub && echo A=1 > ../.env',
    'command cd sub && echo A=1 > ../.env',
    `env python3 -c "open('.env','w')"`,
    `python3 -Bc "open('.env','w')"`,
    `node --eval="require('fs').writeFileSync('.env','x')"`,
  ]) {
    assert.equal(run(dir, command), 'deny', command);
  }
});

test('the hook can start in a subdirectory: targets are judged from there', (t) => {
  const dir = project(t);
  const from = (command) => decide({ tool_name: 'Bash', tool_input: { command }, cwd: path.join(dir, 'sub') }, dir);
  assert.equal(from('echo A=1 > ../.env').decision, 'deny');
  assert.equal(from('cd .. && echo A=1 > .env').decision, 'deny');
  assert.equal(from('cd .. && cd sub && echo A=1 > ../.env').decision, 'deny');
  assert.equal(from('cd "$D" && echo A=1 > .env').reason, 'the working directory depends on shell expansion');
  assert.equal(from('echo A=1 > $F').reason, 'write target depends on shell expansion');
  assert.equal(from('cd "$D" && cd /tmp && echo A=1 > x.txt').decision, 'allow', 'an absolute cd makes the directory known again');
});

test('everyday commands do not cry wolf', (t) => {
  expectAll(t, 'allow', ['git restore .', 'git checkout -- .', 'git checkout main', 'cp $SRC dest.txt', 'node -e "console.log(1)"', 'cd sub && npm test']);
});

test('shellWriteTargets keeps its plain-list shape', () => {
  assert.deepEqual(shellWriteTargets('echo x > a.txt && tee b.txt'), ['a.txt', 'b.txt']);
});

test('a cd behind a keyword or a brace group still moves the directory', (t) => {
  expectAll(t, 'deny', [
    '{ cd sub; echo A=1 > ../.env; }',
    'for d in x; do cd sub; echo A=1 > ../.env; done',
    'if true; then cd sub; fi; echo A=1 > ../.env',
  ]);
});

test('a redirection needs no spaces, and clobber / both-streams forms write too', (t) => {
  expectAll(t, 'deny', ['echo A=1>.env', 'cd sub && echo A=1>../.env', 'echo A=1 >| .env', 'echo A=1 &> .env', 'echo A=1 >& .env', 'echo A=1 >>.env']);
  expectAll(t, 'allow', ['npm test 2>&1', 'echo hi >&2', 'echo hi 1>&2', 'npm test >out.log 2>&1', 'echo a>b.txt']);
});

test('a wrapper option that takes a value does not hide the verb', (t) => {
  expectAll(t, 'deny', [
    'cd sub && sudo -u root tee ../.env',
    'nice -n 5 tee .env',
    'timeout 5 tee .env',
    'timeout -s KILL 5 tee .env',
    'env -u HOME tee .env',
  ]);
  expectAll(t, 'allow', ['sudo -u root tee out.txt', 'timeout 5 npm test']);
});

test('a mode prefix inside an inline literal does not hide the path', (t) => {
  expectAll(t, 'deny', ["perl -e 'open(F,\">.env\")'", "perl -e 'open(F, \">> .env\")'"]);
  expectAll(t, 'allow', ["perl -e 'print 1'"]);
});

test('an interpreter fed by a heredoc is unchecked, not silently allowed', (t) => {
  const dir = project(t);
  assert.equal(run(dir, 'python3 - <<EOF\nopen(".env","w")\nEOF'), 'unchecked');
  assert.equal(run(dir, 'bash <<EOF\necho A=1 > .env\nEOF'), 'unchecked');
  assert.equal(run(dir, 'cat <<EOF > notes.md\nhello\nEOF'), 'allow');
  assert.equal(run(dir, 'python3 script.py <<EOF\ndata\nEOF'), 'allow');
});

test('a cd through a symlink is followed physically, like the kernel does', (t) => {
  const dir = project(t);
  fs.mkdirSync(path.join(dir, 'sub', 'deeper'));
  fs.symlinkSync('sub/deeper', path.join(dir, 'lnk'));
  assert.equal(run(dir, 'cd sub/deeper && echo A=1 > ../../.env'), 'deny');
  for (const command of [
    'cd lnk && echo A=1 > ../../.env',
    'cd lnk && cp x ../../.env',
    'cd lnk && git checkout -- ../../.env',
    'git -C lnk checkout -- ../../.env',
  ]) {
    assert.equal(run(dir, command), 'deny', command);
  }
  assert.equal(run(dir, 'cd lnk && echo A=1 > notes.txt'), 'allow');
});

test('in-place editors other than sed -i are write targets', (t) => {
  expectAll(t, 'deny', [
    'sed --in-place s/a/b/ .env',
    "perl -pi -e 's/a/b/' .env",
    "perl -i.bak -pe 's/a/b/' .env",
    "awk -i inplace '{print}' .env",
    'truncate -s0 .env',
    'truncate --size 0 .env',
  ]);
  expectAll(t, 'allow', ["perl -pi -e 's/a/b/' README.md", 'truncate -s 0 notes.txt', 'awk \'{print}\' README.md']);
});

test('a bare open() mode in inline code is not a path', (t) => {
  const dir = project(t);
  fs.writeFileSync(path.join(dir, '.coding-flow', 'harness.json'), JSON.stringify({ blockedPaths: ['w'] }));
  assert.equal(run(dir, `python3 -c "open('notes.txt','w')"`), 'allow');
});
