'use strict';

// Contract tests for scripts/mutation-probe.js (story 15-04): sites come from
// the diff's added source lines only, sampling is deterministic, each mutant
// runs in a throwaway worktree, and the repository's own tree is untouched.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn, spawnSync } = require('node:child_process');

const { findSites, sample, addedLines, relocate, parseArgs, removeWorktree, runCommand, runMutants, summarize, probe } = require('../scripts/mutation-probe');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'mutation-probe.js');

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

// A pid nothing runs as: EPERM means someone else's process, alive.
function deadPid() {
  for (let pid = 999999; ; pid -= 1) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error.code === 'ESRCH') {
        return pid;
      }
    }
  }
}

function scratch(t, prefix) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// Sets environment variables for one test, then puts them back.
function withEnv(t, vars) {
  const saved = Object.fromEntries(Object.keys(vars).map((name) => [name, process.env[name]]));
  Object.assign(process.env, vars);
  t.after(() => Object.entries(saved).forEach(([name, value]) => (value === undefined ? delete process.env[name] : (process.env[name] = value))));
}

// A repo whose second commit adds `isAdult` (pinned on both sides of the
// bound) and `label`, plus a comment and a string that hold operators.
function fixture(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-mutation-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@example.com');
  git(dir, 'config', 'user.name', 't');
  fs.writeFileSync(path.join(dir, 'lib.js'), 'module.exports = {};\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'base');
  fs.writeFileSync(path.join(dir, 'lib.js'), [
    '// a comment with === and true in it',
    'function isAdult(age) {',
    '  return age >= 18;',
    '}',
    'function label(user) {',
    '  const note = "a && b";',
    '  return user.banned === true ? "banned" : "ok";',
    '}',
    'module.exports = { isAdult, label };',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(dir, 'lib.test.js'), [
    "const { test } = require('node:test');",
    "const assert = require('node:assert');",
    "const { isAdult, label } = require('./lib');",
    "test('adult bound', () => { assert.equal(isAdult(18), true); assert.equal(isAdult(17), false); });",
    "test('banned', () => { assert.equal(label({ banned: true }), 'banned'); });",
    '',
  ].join('\n'));
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'feature');
  return dir;
}

test('strings and comments are not sites, relational swaps need spaces', () => {
  const lines = [
    '// === true',
    'const s = "a && b" + `x || y`;',
    'if (a === b && !c) {}',
    'const xs: Array<string> = [];',
    'const f = (x) => x > 0;',
    'if (a !== b) {}',
  ];
  const sites = findSites('f.ts', lines, [1, 2, 3, 4, 5, 6]).map((s) => `${s.line}:${s.operator}`);
  assert.deepEqual(sites.sort(), ['3:&& → ||', '3:=== → !==', '3:drop !', '5:> → >=', '6:!== → ==='].sort());
});

test('sampling is the same for the same seed, whatever the input order', () => {
  const sites = findSites('f.js', ['a === b && c || d', 'x < y', 'z > w'], [1, 2, 3]);
  const one = sample(sites, 3, 'seed').map((s) => `${s.line}:${s.column}`);
  const two = sample([...sites].reverse(), 3, 'seed').map((s) => `${s.line}:${s.column}`);
  assert.deepEqual(one, two);
  assert.equal(one.length, 3);
  // The seed decides: over twelve sites, two seeds do not give the same order.
  const many = findSites('g.js', Array.from({ length: 12 }, (_, i) => `v${i} === w${i}`), Array.from({ length: 12 }, (_, i) => i + 1));
  const order = (seed) => sample(many, 12, seed).map((s) => s.line).join(',');
  assert.notEqual(order('a'), order('b'));
});

test('added lines are read from the diff, and relocated verbatim or dropped', () => {
  const diff = [
    'diff --git a/a.js b/a.js', '--- a/a.js', '+++ b/a.js', '@@ -0,0 +3,3 @@', '+one', '+two', '+++ starts with two pluses',
    'diff --git "a/caf\\303\\251.js" "b/caf\\303\\251.js"', '--- /dev/null', '+++ "b/caf\\303\\251.js"', '@@ -0,0 +1 @@', '+x',
    'diff --git a/gone.js b/gone.js', '--- a/gone.js', '+++ /dev/null', '@@ -1 +0,0 @@', '-y',
  ].join('\n');
  assert.deepEqual(addedLines(diff), {
    'a.js': [{ line: 3, text: 'one' }, { line: 4, text: 'two' }, { line: 5, text: '++ starts with two pluses' }],
    'café.js': [{ line: 1, text: 'x' }],
  });
  assert.equal(relocate(['x', 'two', 'y', 'two'], { line: 4, text: 'two' }), 4);
  assert.equal(relocate(['x'], { line: 1, text: 'gone' }), null);
});

test('a probe kills pinned mutants, reports survivors, and leaves the repository as it was', async (t) => {
  const dir = fixture(t);
  const before = git(dir, 'status', '--porcelain') + git(dir, 'worktree', 'list');
  const lines = [];
  const report = await probe({
    repo: dir, base: 'HEAD~1', head: 'HEAD', at: 'HEAD', paths: [], tests: [], link: [], max: 30,
    seed: 's', linkFrom: dir, command: 'node --test {files}',
  }, (line) => lines.push(line));

  assert.deepEqual(report.tests, ['lib.test.js']);
  // `>=` on line 3, `===` and `true` on line 7: the comment and the string are not sites.
  assert.deepEqual(report.mutants.map((m) => `${m.line}:${m.operator}:${m.status}`).sort(), [
    '3:>= → >:killed',
    '7:=== → !==:killed',
    '7:true → false:killed',
  ]);
  assert.equal(report.killed, 3);
  assert.equal(report.survived, 0);
  assert.equal(git(dir, 'status', '--porcelain') + git(dir, 'worktree', 'list'), before);
  assert.match(lines.join('\n'), /Killed 3\/3 \(100 %\)/);
});

test('a mutant the tests still pass on is reported as survived, with its line', async (t) => {
  const dir = fixture(t);
  // Only the banned case is run: the bound on isAdult is unpinned.
  const report = await probe({
    repo: dir, base: 'HEAD~1', head: 'HEAD', at: 'HEAD', paths: [], tests: [], link: [], max: 30,
    seed: 's', linkFrom: dir, command: "node --test --test-name-pattern=banned {files}",
  }, () => {});
  const survived = report.mutants.filter((m) => m.status === 'survived');
  assert.deepEqual(survived.map((m) => [m.line, m.before, m.after]), [[3, 'return age >= 18;', 'return age > 18;']]);
});

test('a mutant that fails on a type error is reported as compile, not killed', async (t) => {
  const dir = fixture(t);
  const report = await probe({
    repo: dir, base: 'HEAD~1', head: 'HEAD', at: 'HEAD', paths: [], tests: [], link: [], max: 30,
    seed: 's', linkFrom: dir, command: 'node --test {files} > /dev/null || { echo "lib.ts(3,3): error TS2322: x"; exit 1; }',
  }, () => {});
  assert.deepEqual(report.mutants.map((m) => m.status), ['compile', 'compile', 'compile']);
  assert.equal(report.killed, 0);
  assert.equal(report.compile, 3);
});

test('a red baseline runs no mutant', async (t) => {
  const dir = fixture(t);
  const report = await probe({
    repo: dir, base: 'HEAD~1', head: 'HEAD', at: 'HEAD', paths: [], tests: [], link: [], max: 30,
    seed: 's', linkFrom: dir, command: 'exit 1',
  }, () => {});
  assert.equal(report.error, 'the unmutated tree does not pass the command');
  assert.deepEqual(report.mutants, []);
  assert.equal(git(dir, 'worktree', 'list').trim().split('\n').length, 1);
});

test('--paths narrows the sites but not the tests, and an empty {files} is refused', async (t) => {
  const dir = fixture(t);
  const report = await probe({
    repo: dir, base: 'HEAD~1', head: 'HEAD', at: 'HEAD', paths: ['lib.js'], tests: [], link: [], max: 30,
    seed: 's', linkFrom: dir, command: 'node --test {files}', dryRun: true,
  }, () => {});
  assert.deepEqual(report.tests, ['lib.test.js']);

  fs.writeFileSync(path.join(dir, 'lib.js'), 'module.exports = { x: 1 === 1 };\n');
  git(dir, 'commit', '-q', '-am', 'no test');
  const empty = await probe({
    repo: dir, base: 'HEAD~1', head: 'HEAD', at: 'HEAD', paths: [], tests: [], link: [], max: 30,
    seed: 's', linkFrom: dir, command: 'node --test {files}',
  }, () => {});
  assert.match(empty.error, /no test file for \{files\}/);
  assert.equal(git(dir, 'worktree', 'list').trim().split('\n').length, 1);
});

test('a multi-line template is not code, a regex is not a string start', () => {
  const lines = ['const q = `', '  WHERE active = true AND n >= 1', '`;', 'x === y', '/* a', ' true */ ok === 1'];
  const sites = findSites('q.ts', lines, [1, 2, 3, 4, 5, 6]).map((s) => `${s.line}:${s.operator}`);
  assert.deepEqual(sites.sort(), ['4:=== → !==', '6:=== → !=='].sort());
});

test('a value-taking flag needs its value, and --max is a positive integer', () => {
  assert.throws(() => parseArgs(['--base', 'x', '--command', 'c', '--link']), /--link needs a value/);
  assert.throws(() => parseArgs(['--base', 'x', '--command', 'c', '--max', 'abc']), /--max must be a positive integer/);
  assert.throws(() => parseArgs(['--base', 'x', '--command', 'c', '--timeout', '0']), /--timeout/);
  assert.equal(parseArgs(['--base', 'x', '--dry-run']).max, 30);
});

const base = (dir, over) => ({
  repo: dir, base: 'HEAD~1', head: 'HEAD', at: 'HEAD', paths: [], tests: [], link: [], max: 30,
  seed: 's', linkFrom: dir, command: 'node --test {files}', ...over,
});

test('another stale worktree of the repository survives a probe', async (t) => {
  const dir = fixture(t);
  const other = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-mutation-other-')));
  t.after(() => fs.rmSync(other, { recursive: true, force: true }));
  git(dir, 'worktree', 'add', '--detach', '--quiet', path.join(other, 'wt'), 'HEAD');
  fs.renameSync(path.join(other, 'wt'), path.join(other, 'moved')); // now prunable
  const before = git(dir, 'worktree', 'list', '--porcelain');

  await probe(base(dir, { max: 1 }), () => {});

  assert.equal(git(dir, 'worktree', 'list', '--porcelain'), before);
});

test('--link names only paths inside the worktree, and links what it names', async (t) => {
  const dir = fixture(t);
  for (const link of ['.', '', '../x', '/etc']) {
    await assert.rejects(probe(base(dir, { link: [link], max: 1 }), () => {}), /does not name a path inside the worktree/, link);
  }
  assert.equal(git(dir, 'status', '--porcelain'), '');
  assert.equal(git(dir, 'worktree', 'list').trim().split('\n').length, 1);

  const deps = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-mutation-deps-')));
  t.after(() => fs.rmSync(deps, { recursive: true, force: true }));
  fs.mkdirSync(path.join(deps, 'vendor'));
  fs.writeFileSync(path.join(deps, 'vendor', 'marker'), 'kept');
  const report = await probe(base(dir, { link: ['vendor'], linkFrom: deps, max: 1, command: 'test -f vendor/marker && node --test {files}' }), () => {});
  assert.equal(report.error, undefined);
  assert.equal(fs.readFileSync(path.join(deps, 'vendor', 'marker'), 'utf8'), 'kept');
});

test('a timeout stops every process the command started', async (t) => {
  const dir = fixture(t);
  // The baseline passes at once; a mutant (the worktree differs from HEAD) sleeps
  // in a child of `sh` that holds its output.
  const command = 'git diff --quiet || sleep 30; node --test {files} > /dev/null';
  const started = Date.now();
  const report = await probe(base(dir, { command, timeout: '1', max: 1 }), () => {});
  assert.deepEqual(report.mutants.map((m) => m.status), ['timeout']);
  assert.ok(Date.now() - started < 20000, 'the sleeping child was killed with its group');
});

test('Ctrl-C ends the run with 130, counts no interrupted mutant, and removes the worktree', async (t) => {
  const dir = fixture(t);
  const before = fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith('mutation-probe-'));
  // The baseline passes at once; the first mutant sleeps until interrupted.
  const command = 'git diff --quiet || sleep 31.7';
  t.after(() => spawnSync('pkill', ['-9', '-f', '^sleep 31\\.7$']));
  const child = spawn(process.execPath, [SCRIPT, '--repo', dir, '--base', 'HEAD~1', '--command', command], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let sent = 0;
  child.stdout.on('data', (chunk) => {
    out += chunk;
    if (out.includes('Baseline: pass') && !sent) {
      sent = Date.now() + 500;
      setTimeout(() => child.kill('SIGINT'), 500);
    }
  });
  const code = await new Promise((resolve) => child.on('close', resolve));

  assert.equal(code, 130);
  assert.ok(Date.now() - sent < 15000, 'the running command was stopped, not waited for');
  assert.equal(spawnSync('pgrep', ['-f', '^sleep 31\\.7$']).status, 1, 'the interrupted group is gone');
  assert.doesNotMatch(out, /killed/);
  assert.match(out, /Interrupted after 0 mutant/);
  assert.equal(git(dir, 'worktree', 'list').trim().split('\n').length, 1);
  const after = fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith('mutation-probe-'));
  assert.deepEqual(after.filter((name) => !before.includes(name)), []);
});

test('--repo may be a subdirectory: paths are read from the repository root', async (t) => {
  const dir = fixture(t);
  fs.mkdirSync(path.join(dir, 'sub'));
  const report = await probe(base(dir, { repo: path.join(dir, 'sub'), dryRun: true }), () => {});
  assert.equal(report.sites, 3);
  assert.deepEqual(report.tests, ['lib.test.js']);
});

test('nested templates, regex literals and continued strings are not code', () => {
  const lines = [
    'const a = `${ok ? `true && yes` : "n"}` && go;',
    'const r = /`/; x === y;',
    "const s = 'one \\",
    "  true && two';",
    'const d = total / count >= 1;',
  ];
  const sites = findSites('n.ts', lines, [1, 2, 3, 4, 5]).map((s) => `${s.line}:${s.operator}`);
  assert.deepEqual(sites.sort(), ['1:&& → ||', '2:=== → !==', '5:>= → >'].sort());
});

test('a context line inside a hunk moves the count on', () => {
  const diff = ['diff --git a/m.js b/m.js', '--- a/m.js', '+++ b/m.js', '@@ -1,2 +1,4 @@', '+a', ' x', ' y', '+c'].join('\n');
  assert.deepEqual(addedLines(diff), { 'm.js': [{ line: 1, text: 'a' }, { line: 4, text: 'c' }] });
});

test('a path with a space keeps its name', () => {
  const diff = ['diff --git a/my lib.js b/my lib.js', '--- a/my lib.js', '+++ b/my lib.js\t', '@@ -0,0 +1 @@', '+x'].join('\n');
  assert.deepEqual(addedLines(diff), { 'my lib.js': [{ line: 1, text: 'x' }] });
});

test('--link refuses overlapping links and a link holding a site or test file', async (t) => {
  const dir = fixture(t);
  await assert.rejects(probe(base(dir, { link: ['vendor', 'vendor/x'] }), () => {}), /overlaps another --link/);
  await assert.rejects(probe(base(dir, { link: ['lib.js'] }), () => {}), /holds lib\.js/);
  assert.equal(git(dir, 'worktree', 'list').trim().split('\n').length, 1);
});

test("git's location variables never point the probe at the user's repository", async (t) => {
  const dir = fixture(t);
  // A read-only directory in the worktree makes `git worktree remove` fail.
  // The command checks it sees the worktree, not the user's repository, as its git tree.
  const command = 'test "$(git rev-parse --show-toplevel)" = "$(pwd -P)" && mkdir -p ro && touch ro/f && chmod 555 ro && node --test {files} > /dev/null';
  const env = { ...process.env, GIT_DIR: path.join(dir, '.git'), GIT_WORK_TREE: dir };
  delete env.NODE_TEST_CONTEXT;
  const run = spawnSync(process.execPath, [SCRIPT, '--repo', dir, '--base', 'HEAD~1', '--max', '1', '--command', command], { env, encoding: 'utf8' });
  for (const line of run.stdout.split('\n').filter((l) => l.includes('mutation-probe-') && l.includes('could not remove'))) {
    const left = /could not remove (\S+)/.exec(line)[1];
    spawnSync('chmod', ['-R', 'u+w', left]);
    fs.rmSync(left, { recursive: true, force: true });
  }

  assert.ok(fs.existsSync(path.join(dir, '.git', 'HEAD')), 'the repository is intact');
  assert.equal(git(dir, 'rev-parse', '--verify', 'HEAD~1').length > 0, true);
  assert.equal(git(dir, 'status', '--porcelain'), '');
  assert.equal(git(dir, 'worktree', 'list').trim().split('\n').length, 1);
  assert.match(run.stdout, /Baseline: pass/);
  assert.match(run.stdout, /Killed 1\/1/);
});

test("a failed removal never deletes a directory that is not the probe's own worktree admin", (t) => {
  const dir = fixture(t);
  const lines = [];
  // As if git had answered the repository's own .git for the worktree's admin directory.
  removeWorktree({ repo: dir }, path.join(dir, 'no-such-tree'), path.join(dir, '.git'), (line) => lines.push(line));
  assert.ok(fs.existsSync(path.join(dir, '.git', 'HEAD')));
  assert.match(lines.join('\n'), /left .* registered: its admin directory is not under/);
});

test("the repository's hooks do not run for the probe's worktree", async (t) => {
  const dir = fixture(t);
  const marker = path.join(dir, '..', path.basename(dir) + '-hook-ran');
  t.after(() => fs.rmSync(marker, { force: true }));
  fs.writeFileSync(path.join(dir, '.git', 'hooks', 'post-checkout'), `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o755 });
  await probe(base(dir, { max: 1 }), () => {});
  assert.equal(fs.existsSync(marker), false);
});

test('a worktree an earlier SIGKILLed run left is removed by the next run', async (t) => {
  const dir = fixture(t);
  const dead = deadPid();
  const left = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), `mutation-probe-${dead}-`));
  t.after(() => fs.rmSync(left, { recursive: true, force: true }));
  git(dir, 'worktree', 'add', '--detach', '--quiet', path.join(left, 'tree'), 'HEAD');
  const lines = [];

  await probe(base(dir, { max: 1 }), (line) => lines.push(line));

  assert.equal(git(dir, 'worktree', 'list').trim().split('\n').length, 1);
  assert.equal(fs.existsSync(left), false);
  assert.match(lines.join('\n'), new RegExp(`Removed a worktree left by an earlier run \\(pid ${dead}\\)`));
});

for (const [signal, code, sleep] of [['SIGTERM', 143, '30.3'], ['SIGHUP', 129, '30.4']]) {
  test(`${signal} ends the run with ${code}, stops the command's group and removes the worktree`, async (t) => {
    const dir = fixture(t);
    const pattern = '^sleep ' + sleep.replace('.', '\\.') + '$';
    t.after(() => spawnSync('pkill', ['-9', '-f', pattern]));
    const child = spawn(process.execPath, [SCRIPT, '--repo', dir, '--base', 'HEAD~1', '--command', 'git diff --quiet || sleep ' + sleep], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let sent = 0;
    child.stdout.on('data', (chunk) => {
      out += chunk;
      if (out.includes('Baseline: pass') && !sent) {
        sent = Date.now() + 500;
        setTimeout(() => child.kill(signal), 500);
      }
    });
    assert.equal(await new Promise((resolve) => child.on('close', resolve)), code);
    assert.ok(Date.now() - sent < 15000, 'the running command was stopped, not waited for');
    assert.equal(spawnSync('pgrep', ['-f', pattern]).status, 1, 'the group is gone');
    assert.equal(git(dir, 'worktree', 'list').trim().split('\n').length, 1);
  });
}

test('a revision that looks like an option is refused before git sees it', async (t) => {
  const dir = fixture(t);
  const victim = path.join(dir, '..', path.basename(dir) + '-victim.txt');
  fs.writeFileSync(victim, 'kept');
  t.after(() => fs.rmSync(victim, { force: true }));
  assert.throws(() => parseArgs(['--base', '--output=' + victim, '--dry-run']), /is not a revision/);
  await assert.rejects(probe(base(dir, { head: '--output=' + victim, dryRun: true }), () => {}), /is not a commit/);
  await assert.rejects(probe(base(dir, { at: 'no-such-ref', dryRun: true }), () => {}), /--at "no-such-ref" is not a commit/);
  assert.equal(fs.readFileSync(victim, 'utf8'), 'kept');
});

test("--link .git is refused: the command never gets the repository's own .git", async (t) => {
  const dir = fixture(t);
  for (const link of ['.git', '.GIT', '.git/objects']) {
    await assert.rejects(probe(base(dir, { link: [link], max: 1 }), () => {}), /repository's own \.git/, link);
  }
});

test('added lines keep their numbers when git merges hunks (diff.interHunkContext)', async (t) => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-mutation-hunks-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@example.com');
  git(dir, 'config', 'user.name', 't');
  git(dir, 'config', 'diff.interHunkContext', '5');
  fs.writeFileSync(path.join(dir, 'm.js'), 'x();\ny();\nz();\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'base');
  fs.writeFileSync(path.join(dir, 'm.js'), 'a === b;\nx();\ny();\nc === d;\nz();\n');
  git(dir, 'commit', '-q', '-am', 'two hunks');
  const report = await probe(base(dir, { dryRun: true, command: undefined }), () => {});
  assert.deepEqual(report.mutants.map((m) => m.line).sort(), [1, 4]);
});

test("a later run kills a SIGKILLed run's process group only while it still works in that run's worktree", async (t) => {
  const dir = fixture(t);
  let dead = 999999;
  while (spawnSync('kill', ['-0', String(dead)]).status === 0) {
    dead -= 1;
  }
  const make = () => {
    const left = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), `mutation-probe-${dead}-`));
    t.after(() => fs.rmSync(left, { recursive: true, force: true }));
    git(dir, 'worktree', 'add', '--detach', '--quiet', path.join(left, 'tree'), 'HEAD');
    return left;
  };
  const ours = make();
  const theirs = make();
  // One group still runs inside the left worktree; the other pid was reused by someone else.
  const inside = spawn('sleep', ['60'], { cwd: path.join(ours, 'tree'), detached: true, stdio: 'ignore' });
  const elsewhere = spawn('sleep', ['60'], { cwd: os.tmpdir(), detached: true, stdio: 'ignore' });
  t.after(() => [inside, elsewhere].forEach((child) => spawnSync('kill', ['-9', String(child.pid)])));
  fs.writeFileSync(path.join(ours, 'running'), String(inside.pid));
  fs.writeFileSync(path.join(theirs, 'running'), String(elsewhere.pid));
  const exited = new Promise((resolve) => inside.on('exit', resolve));

  await probe(base(dir, { max: 1 }), () => {});
  const late = new Promise((resolve) => setTimeout(() => resolve('still running'), 5000).unref());
  assert.notEqual(await Promise.race([exited, late]), 'still running', 'the left group was killed, not waited for');

  assert.equal(spawnSync('kill', ['-0', String(elsewhere.pid)]).status, 0, "someone else's group is untouched");
  assert.equal(git(dir, 'worktree', 'list').trim().split('\n').length, 1);
});

test('a closed output pipe does not leave the worktree registered', async (t) => {
  const dir = fixture(t);
  const child = spawn(process.execPath, [SCRIPT, '--repo', dir, '--base', 'HEAD~1', '--command', 'node --test {files} > /dev/null'], { stdio: ['ignore', 'pipe', 'ignore'] });
  child.stdout.once('data', () => child.stdout.destroy());
  await new Promise((resolve) => child.on('close', resolve));
  assert.equal(git(dir, 'worktree', 'list').trim().split('\n').length, 1);
});

test('--json does not overwrite an existing file without --force', (t) => {
  const dir = fixture(t);
  const out = path.join(dir, 'report.json');
  fs.writeFileSync(out, 'mine');
  assert.throws(() => parseArgs(['--base', 'x', '--dry-run', '--json', out]), /exists: pass --force/);
  assert.equal(parseArgs(['--base', 'x', '--dry-run', '--json', out, '--force']).force, true);
  assert.equal(fs.readFileSync(out, 'utf8'), 'mine');
});

test('a link through a tracked symlink is refused, and what it points to is kept', async (t) => {
  const dir = fixture(t);
  const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-mutation-outside-')));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.mkdirSync(path.join(outside, 'node_modules'));
  fs.writeFileSync(path.join(outside, 'node_modules', 'keep'), 'mine');
  fs.symlinkSync(outside, path.join(dir, 'pkg'));
  git(dir, 'add', 'pkg');
  git(dir, 'commit', '-q', '-m', 'tracked symlink');
  await assert.rejects(probe(base(dir, { base: 'HEAD~2', link: ['pkg/node_modules'], max: 1 }), () => {}), /goes through a symlink/);
  assert.equal(fs.readFileSync(path.join(outside, 'node_modules', 'keep'), 'utf8'), 'mine');
});

test('no mutant is written through a path that resolves outside the worktree', async (t) => {
  const tree = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-mutation-tree-')));
  const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-mutation-outside-')));
  t.after(() => [tree, outside].forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
  fs.writeFileSync(path.join(outside, 'lib.js'), 'a === b;\n');
  fs.symlinkSync(path.join(outside, 'lib.js'), path.join(tree, 'lib.js'));
  const [site] = findSites('lib.js', ['a === b;'], [1]);
  await assert.rejects(runMutants([site], 'true', tree, 1000, { interrupted: false }, () => {}), /resolves outside the worktree/);
  assert.equal(fs.readFileSync(path.join(outside, 'lib.js'), 'utf8'), 'a === b;\n');
});

test('a property named true, a $true identifier and a non-null assertion are not sites', () => {
  const sites = findSites('t.ts', ['x.true; $true; fn!(a); y!.z; ok = !done && true;'], [1]).map((s) => s.operator);
  assert.deepEqual(sites.sort(), ['&& → ||', 'drop !', 'true → false'].sort());
});

test('--timeout past what setTimeout holds is refused', () => {
  assert.throws(() => parseArgs(['--base', 'x', '--command', 'c', '--timeout', '3000000']), /between 0 and 2147483/);
  assert.equal(parseArgs(['--base', 'x', '--command', 'c', '--timeout', '2147483']).timeout, '2147483');
});

test('a nested .git is refused as a link too', async (t) => {
  const dir = fixture(t);
  await assert.rejects(probe(base(dir, { link: ['vendor/lib/.git'], max: 1 }), () => {}), /own \.git/);
});

test('{files} gets test files by name, never a helper under a test directory', async (t) => {
  const dir = fixture(t);
  fs.mkdirSync(path.join(dir, 'test', 'helpers'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'test', 'helpers', 'mock.js'), 'module.exports = 1;\n');
  fs.appendFileSync(path.join(dir, 'lib.js'), 'module.exports.extra = 1 === 1;\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'helper');
  const report = await probe(base(dir, { base: 'HEAD~2', dryRun: true }), () => {});
  assert.deepEqual(report.tests, ['lib.test.js']);
});

test('a TMPDIR inside the repository is refused before any worktree is added', async (t) => {
  const dir = fixture(t);
  fs.mkdirSync(path.join(dir, 'tmp'));
  withEnv(t, { TMPDIR: path.join(dir, 'tmp') });
  await assert.rejects(probe(base(dir, { max: 1 }), () => {}), /is inside the repository: set TMPDIR elsewhere/);
  assert.equal(git(dir, 'worktree', 'list').trim().split('\n').length, 1);
});

test('a background process the command left does not turn a pass into a timeout', async (t) => {
  const dir = scratch(t, 'coding-flow-mutation-run-');
  const run = await runCommand('sleep 32.6 & echo started', dir, 10000, {});
  assert.equal(run.status, 'pass');
  assert.ok(run.durationMs < 5000, `took ${run.durationMs}ms`);
  assert.notEqual(spawnSync('pgrep', ['-f', '^sleep 32\\.6$']).status, 0);
});

test('the running file names the group while the command runs, and is emptied after', async (t) => {
  const dir = scratch(t, 'coding-flow-mutation-run-');
  const run = await runCommand('cat running', dir, 10000, { tmp: dir });
  assert.match(run.tail, /^\d+$/m);
  assert.equal(fs.readFileSync(path.join(dir, 'running'), 'utf8'), '');
});

test('a command that cannot start is an error, not a kill', async (t) => {
  const dir = scratch(t, 'coding-flow-mutation-run-');
  const run = await runCommand('true', path.join(dir, 'missing'), 10000, {});
  assert.equal(run.status, 'error');
});

test('the command never sees git config passed down by a hook', async (t) => {
  const dir = scratch(t, 'coding-flow-mutation-run-');
  withEnv(t, { GIT_CONFIG_PARAMETERS: "'core.worktree'='/x'", GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.worktree', GIT_CONFIG_VALUE_0: '/x' });
  const run = await runCommand('test -z "$GIT_CONFIG_PARAMETERS$GIT_CONFIG_COUNT$GIT_CONFIG_KEY_0$GIT_CONFIG_VALUE_0"', dir, 10000, {});
  assert.equal(run.status, 'pass');
});

test('a site whose text is no longer at its column is not applied, and the file is kept', async (t) => {
  const tree = scratch(t, 'coding-flow-mutation-tree-');
  fs.writeFileSync(path.join(tree, 'lib.js'), 'a !== b;\n');
  const [site] = findSites('lib.js', ['a === b;'], [1]);
  const mutants = await runMutants([site], 'exit 1', tree, 10000, {}, () => {});
  assert.deepEqual(mutants.map((m) => m.status), ['not applied']);
  assert.equal(fs.readFileSync(path.join(tree, 'lib.js'), 'utf8'), 'a !== b;\n');
});

test('only a SyntaxError at the start of a line, or a TS code, the baseline did not print, is compile', async (t) => {
  const tree = scratch(t, 'coding-flow-mutation-tree-');
  fs.writeFileSync(path.join(tree, 'lib.js'), 'a === b;\n');
  const [site] = findSites('lib.js', ['a === b;'], [1]);
  const status = async (command, noise) => (await runMutants([site], command, tree, 10000, {}, () => {}, noise))[0].status;
  assert.equal(await status('echo "it threw a SyntaxError: x"; exit 1'), 'killed');
  assert.equal(await status('echo "  SyntaxError: Unexpected token"; exit 1'), 'compile');
  assert.equal(await status('echo "lib.ts(1,1): error TS2322: x"; exit 1'), 'compile');
  assert.equal(await status('echo "lib.ts(1,1): error TS2322: x"; exit 1', new Set(['lib.ts(1,1): error TS2322: x'])), 'killed');
});

test('a TS code the passing baseline already prints does not make every mutant compile', async (t) => {
  const dir = fixture(t);
  const report = await probe(base(dir, { command: 'echo "warning TS6133: unused"; node --test {files} > /dev/null' }), () => {});
  assert.deepEqual(report.mutants.map((m) => m.status), ['killed', 'killed', 'killed']);
});

test('mocks, declaration files and stories hold no site', async (t) => {
  const dir = fixture(t);
  fs.mkdirSync(path.join(dir, '__mocks__'));
  for (const file of ['__mocks__/db.js', 'types.d.ts', 'button.stories.tsx']) {
    fs.writeFileSync(path.join(dir, file), 'export const x = 1 === 1;\n');
  }
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'not sites');
  const report = await probe(base(dir, { base: 'HEAD~2', dryRun: true }), () => {});
  assert.deepEqual([...new Set(report.mutants.map((m) => m.file))], ['lib.js']);
});

test('{files} is replaced literally, even by a name holding $&', async (t) => {
  const dir = fixture(t);
  fs.renameSync(path.join(dir, 'lib.test.js'), path.join(dir, 'x$&y.test.js'));
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '--amend', '-m', 'feature');
  const report = await probe(base(dir, { command: 'node --test {files} > /dev/null' }), () => {});
  assert.deepEqual(report.tests, ['x$&y.test.js']);
  assert.equal(report.error, undefined);
  assert.equal(report.killed, 3);
});

test('the rate is killed over killed and survived, rounded down; the rest is counted apart', () => {
  const of = (status, n) => Array.from({ length: n }, () => ({ status }));
  const lines = [];
  summarize({ durationMs: 1000, mutants: [...of('killed', 199), ...of('survived', 1), ...of('timeout', 5), ...of('compile', 4), ...of('error', 2), ...of('not applied', 3)] }, (line) => lines.push(line));
  assert.match(lines.join('\n'), /Killed 199\/200 \(99 %\); apart: 5 timed out, 4 did not compile, 2 did not start, 3 not applied/);
});

test('--json refuses a dangling symlink too', (t) => {
  const dir = scratch(t, 'coding-flow-mutation-json-');
  const out = path.join(dir, 'report.json');
  fs.symlinkSync(path.join(dir, 'elsewhere.json'), out);
  assert.throws(() => parseArgs(['--base', 'x', '--dry-run', '--json', out]), /exists: pass --force/);
});

test('a leftover that cannot be removed is logged, and the run goes on', async (t) => {
  const dir = fixture(t);
  const left = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), `mutation-probe-${deadPid()}-`));
  t.after(() => {
    fs.chmodSync(left, 0o755);
    fs.rmSync(left, { recursive: true, force: true });
  });
  git(dir, 'worktree', 'add', '--detach', '--quiet', path.join(left, 'tree'), 'HEAD');
  fs.chmodSync(left, 0o555);
  const lines = [];
  const report = await probe(base(dir, { max: 1 }), (line) => lines.push(line));
  assert.match(lines.join('\n'), /Warning: could not remove .*left by an earlier run/);
  assert.equal(report.mutants.length, 1);
});
