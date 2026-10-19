'use strict';

// The size ratchet: a function the diff touches may not end the diff longer than
// 80 lines unless it already was, and an already-long function may not grow.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'check-function-size.js');

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'ignore', 'ignore'] });
}

function write(dir, file, content) {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), content);
}

// `function <name>() {` + `lines - 2` statements + `}`: exactly `lines` lines.
function fn(name, lines, body = (i) => `  const v${i} = ${i};`) {
  const inner = Array.from({ length: lines - 2 }, (_, i) => body(i));

  return [`function ${name}() {`, ...inner, '}', ''].join('\n');
}

// main holds `source`; feat/work is the branch the test then edits.
function repo(t, source, file = 'src/fn.js') {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-size-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  write(dir, file, source);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'base']);
  git(dir, ['checkout', '-q', '-b', 'feat/work']);

  return dir;
}

function lcov(dir, entries, file = 'src/fn.js') {
  const fns = entries.map(([line, name]) => `FN:${line},${name}`);
  write(dir, 'coverage/lcov.info', ['TN:', `SF:${file}`, ...fns, 'end_of_record', ''].join('\n'));
}

function check(dir) {
  const res = spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: 'utf8' });

  return { code: res.status, output: `${res.stdout}${res.stderr}` };
}

test('five lines added to a 78-line function fail, naming it 78→83', (t) => {
  const dir = repo(t, fn('build', 78));
  write(dir, 'src/fn.js', fn('build', 83));
  lcov(dir, [[1, 'build']]);

  const res = check(dir);
  assert.equal(res.code, 1, res.output);
  assert.match(res.output, /src\/fn\.js:1 build 78→83/);
});

test('two lines added to a 331-line function fail; removing lines passes', (t) => {
  const dir = repo(t, fn('shellWrites', 331));
  write(dir, 'src/fn.js', fn('shellWrites', 333));
  lcov(dir, [[1, 'shellWrites']]);

  const grown = check(dir);
  assert.equal(grown.code, 1, grown.output);
  assert.match(grown.output, /shellWrites 331→333/);

  write(dir, 'src/fn.js', fn('shellWrites', 328));
  lcov(dir, [[1, 'shellWrites']]);
  const shrunk = check(dir);
  assert.equal(shrunk.code, 0, shrunk.output);
});

test('a diff that touches no long function passes, whatever the repository holds', (t) => {
  const dir = repo(t, fn('legacy', 331));
  write(dir, 'src/small.js', fn('small', 10));
  git(dir, ['add', '-A']);
  write(dir, 'coverage/lcov.info', ['TN:', 'SF:src/fn.js', 'FN:1,legacy', 'end_of_record', 'SF:src/small.js', 'FN:1,small', 'end_of_record', ''].join('\n'));

  const res = check(dir);
  assert.equal(res.code, 0, res.output);
});

test('a long function next to the touched one, in the same file, is grandfathered', (t) => {
  const dir = repo(t, `${fn('legacy', 200)}${fn('small', 10)}`);
  write(dir, 'src/fn.js', `${fn('legacy', 200)}${fn('small', 12)}`);
  lcov(dir, [[1, 'legacy'], [201, 'small']]);

  const res = check(dir);
  assert.equal(res.code, 0, res.output);
});

test('without a coverage/lcov.info it fails and says to run the lcov validation first', (t) => {
  const dir = repo(t, fn('build', 10));
  write(dir, 'src/fn.js', fn('build', 12));

  const res = check(dir);
  assert.equal(res.code, 1, res.output);
  assert.match(res.output, /run the lcov validation first/);
});

test('an empty lcov is refused, not read as "nothing to report"', (t) => {
  const dir = repo(t, fn('build', 10));
  write(dir, 'src/fn.js', fn('build', 12));
  write(dir, 'coverage/lcov.info', '');

  const res = check(dir);
  assert.equal(res.code, 1, res.output);
  assert.match(res.output, /lists no function.*run the lcov validation first/);
});

test('an inline callback that starts mid-line is measured whole', (t) => {
  const body = (n) => Array.from({ length: n }, (_, i) => `  const v${i} = ${i};`).join('\n');
  const callback = (n) => `test('x', (t) => {\n${body(n)}\n});\n`;
  const dir = repo(t, callback(90));
  write(dir, 'src/fn.js', callback(91));
  lcov(dir, [[1, '(anonymous_0)']]);

  const res = check(dir);
  assert.equal(res.code, 1, res.output);
  assert.match(res.output, /\(anonymous_0\) 92→93/);
});

test('an lcov older than the source is refused, not trusted', (t) => {
  const dir = repo(t, fn('build', 10));
  lcov(dir, [[1, 'build']]);
  const old = new Date(Date.now() - 60000);
  fs.utimesSync(path.join(dir, 'coverage/lcov.info'), old, old);
  write(dir, 'src/fn.js', fn('build', 12));

  const res = check(dir);
  assert.equal(res.code, 1, res.output);
  assert.match(res.output, /edited after .*lcov\.info.*run the lcov validation first/);
});

test('a new function over the line fails (0→N); growing under the line passes', (t) => {
  const dir = repo(t, fn('small', 70));
  write(dir, 'src/fn.js', fn('small', 75));
  write(dir, 'src/fresh.js', fn('fresh', 100));
  write(dir, 'coverage/lcov.info', ['TN:', 'SF:src/fn.js', 'FN:1,small', 'end_of_record', 'SF:src/fresh.js', 'FN:1,fresh', 'end_of_record', ''].join('\n'));

  const res = check(dir);
  assert.equal(res.code, 1, res.output);
  assert.match(res.output, /src\/fresh\.js:1 fresh 0→100/);
  assert.doesNotMatch(res.output, /small/);
});

test('braces inside strings, templates, comments and regexes do not end a function', (t) => {
  const tricky = (i) => [
    '  const s = "}";',
    "  const t = `${ { a: 1 }.a }}`;",
    '  const r = /\\}/; // }',
    '  /* } */',
  ][i % 4];
  const dir = repo(t, fn('tricky', 90, tricky));
  write(dir, 'src/fn.js', fn('tricky', 91, tricky));
  lcov(dir, [[1, 'tricky']]);

  const res = check(dir);
  assert.equal(res.code, 1, res.output);
  assert.match(res.output, /tricky 90→91/);
});

test('a path with a space is measured, not skipped', (t) => {
  const dir = repo(t, fn('build', 78), 'src/my file.js');
  write(dir, 'src/my file.js', fn('build', 83));
  lcov(dir, [[1, 'build']], 'src/my file.js');

  const res = check(dir);
  assert.equal(res.code, 1, res.output);
  assert.match(res.output, /src\/my file\.js:1 build 78→83/);
});

test('it is declared in this repository\'s validation.quality, next to the other check', () => {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, '.coding-flow', 'config.json'), 'utf8'));

  assert.ok(config.validation.quality.includes('node scripts/check-function-size.js'));
  assert.ok(config.validation.quality.includes('node scripts/check-lock-exit-reachability.js'));
});
