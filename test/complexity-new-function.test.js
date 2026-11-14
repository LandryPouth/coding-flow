'use strict';

// Story 13-12: the size ratchet (`complexity-grew`, story 14-07) measures a new
// function as new, sees growth by deletion, reads every path git prints, and
// never passes a check it could not run. From the independent review of 13-06.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { evaluateComplexity } = require('../bin/lib/complexity');

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'ignore', 'ignore'] });
}

function write(dir, file, content) {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), content);
}

// `function <name>() {` + `lines - 2` statements + `}`: exactly `lines` lines.
function fn(name, lines, prefix = 'v') {
  const inner = Array.from({ length: lines - 2 }, (_, i) => `  const ${prefix}${i} = ${i};`);
  return [`function ${name}() {`, ...inner, '}', ''].join('\n');
}

function init(t, branch = 'main') {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-complexity-new-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  git(dir, ['init', '-q', '-b', branch]);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  write(dir, '.gitignore', 'coverage/\n');
  return dir;
}

// Every line executed, `fns` listed as `FN` records.
function writeLcov(dir, lcovFor) {
  const records = Object.entries(lcovFor).map(([file, fns]) => {
    const count = fs.readFileSync(path.join(dir, file), 'utf8').split('\n').length - 1;
    return [`SF:${file}`, ...fns.map(([line, name]) => `FN:${line},${name}`),
      ...Array.from({ length: count }, (_, i) => `DA:${i + 1},1`), 'end_of_record'];
  });
  write(dir, 'coverage/lcov.info', [...records.flat(), ''].join('\n'));
}

const ENFORCED = { coverageReports: ['coverage/lcov.info'], functionSize: { max: 80, enforce: true } };

// A repository at `files`, branched to `feat`, edited by `edit(dir)`, measured.
function evaluate(t, files, edit, lcovFor) {
  const dir = init(t);
  for (const [file, content] of Object.entries(files)) write(dir, file, content);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'base']);
  git(dir, ['checkout', '-q', '-b', 'feat']);
  edit(dir);
  writeLcov(dir, lcovFor);
  return evaluateComplexity({ root: dir, config: ENFORCED });
}

const grown = (result) => result.items.map((item) => `${item.file} ${item.name} ${item.length.before}→${item.length.after}`);

test('a new function in a hunk that also replaces a line does not borrow the base function below it', (t) => {
  const result = evaluate(t, { 'src/a.js': `// doc\n${fn('old', 120)}` },
    (dir) => write(dir, 'src/a.js', `// doc changed\n${fn('fresh', 100, 'w')}${fn('old', 120)}`),
    { 'src/a.js': [[2, 'fresh'], [102, 'old']] });

  assert.deepStrictEqual(grown(result), ['src/a.js fresh 0→100']);
  assert.equal(result.ok, false);
});

test('a renamed signature on a replaced line is still the same function, measured at the base', (t) => {
  const result = evaluate(t, { 'src/a.js': `// doc\n${fn('build', 100)}` },
    (dir) => write(dir, 'src/a.js', `// doc changed\n${fn('build', 100).replace('build()', 'build(x)')}`),
    { 'src/a.js': [[2, 'build']] });

  assert.deepStrictEqual(grown(result), []);
  assert.equal(result.ok, true);
});

test('a function grown by deletions alone (a helper inlined) is measured', (t) => {
  const head = ['function a() {', ...Array(48).fill('  x();'), '  if (q) {', '  return;', '  }'];
  const base = [...head, '  // tail', '}', 'function b() {', ...Array(48).fill('  y();'), '}', ''].join('\n');
  const after = [...head, ...Array(48).fill('  y();'), '}', ''].join('\n');
  const result = evaluate(t, { 'src/m.js': base }, (dir) => write(dir, 'src/m.js', after), { 'src/m.js': [[1, 'a']] });

  assert.deepStrictEqual(grown(result), ['src/m.js a 54→101']);
  assert.equal(result.ok, false);
});

test('a path git prints quoted is read, and its growth reported', (t) => {
  const result = evaluate(t, { 'src/z.js': fn('z', 10), 'src/a"b.js': fn('build', 85) }, (dir) => {
    write(dir, 'src/z.js', fn('z', 11));
    write(dir, 'src/a"b.js', fn('build', 95));
  }, { 'src/z.js': [[1, 'z']], 'src/a"b.js': [[1, 'build']] });

  assert.deepStrictEqual(grown(result), ['src/a"b.js build 85→95']);
  assert.equal(result.ok, false);
});

test("a quoted path's hunks never land on the file before it", (t) => {
  const result = evaluate(t, { 'src/a.js': `${fn('long', 85)}// end\n`, 'src/b"c.js': 'x\n'.repeat(5) }, (dir) => {
    write(dir, 'src/a.js', `${fn('long', 85)}// end2\n`);
    write(dir, 'src/b"c.js', 'y\n'.repeat(120));
  }, { 'src/a.js': [[1, 'long']], 'src/b"c.js': [] });

  assert.deepStrictEqual(grown(result), []);
  assert.deepStrictEqual(result.unlisted, []);
  assert.equal(result.ok, true);
});

test('a long function moved unchanged into another existing file is not reported', (t) => {
  const result = evaluate(t, { 'src/a.js': fn('keep', 5) + fn('long', 120), 'src/b.js': fn('other', 30) }, (dir) => {
    write(dir, 'src/a.js', fn('keep', 5));
    write(dir, 'src/b.js', fn('other', 30) + fn('long', 120));
  }, { 'src/a.js': [[1, 'keep']], 'src/b.js': [[1, 'other'], [31, 'long']] });

  assert.deepStrictEqual(grown(result), []);
  assert.equal(result.ok, true);
});

test('a long function moved into another file and grown there is still growth', (t) => {
  const result = evaluate(t, { 'src/a.js': fn('keep', 5) + fn('long', 85), 'src/b.js': fn('other', 30) }, (dir) => {
    write(dir, 'src/a.js', fn('keep', 5));
    write(dir, 'src/b.js', fn('other', 30) + fn('long', 95));
  }, { 'src/a.js': [[1, 'keep']], 'src/b.js': [[1, 'other'], [31, 'long']] });

  assert.deepStrictEqual(grown(result), ['src/b.js long 85→95']);
  assert.equal(result.ok, false);
});

test('under enforce, a branch with no merge base is a check that did not run, not a pass', (t) => {
  const dir = init(t, 'feat');
  write(dir, 'src/a.js', fn('build', 85));
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'base']);
  write(dir, 'src/a.js', fn('build', 95));
  git(dir, ['commit', '-qam', 'grow']);
  writeLcov(dir, { 'src/a.js': [[1, 'build']] });
  const result = evaluateComplexity({ root: dir, config: ENFORCED });

  assert.match(result.unavailable || '', /merge base/);
  assert.equal(result.ok, false);
});

test('on the base branch itself, the uncommitted work is what is measured (the scope verify states)', (t) => {
  const dir = init(t);
  write(dir, 'src/a.js', fn('build', 85));
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'base']);
  write(dir, 'src/a.js', fn('build', 95));
  writeLcov(dir, { 'src/a.js': [[1, 'build']] });
  const result = evaluateComplexity({ root: dir, config: ENFORCED });

  assert.equal(result.unavailable, undefined);
  assert.deepStrictEqual(grown(result), ['src/a.js build 85→95']);
  assert.equal(result.ok, false);
});

// --- the review of 13-12: real Node lcov names ------------------------------------

const body = (n, indent = '  ') => Array.from({ length: n }, (_, i) => `${indent}const v${i} = ${i};`).join('\n');

// The lcov a real `node --test --experimental-test-coverage` run writes, not a
// hand-written one: V8 names a test callback `anonymous_0` and an export
// `exports.build`.
function realLcov(dir, testFile) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  fs.mkdirSync(path.join(dir, 'coverage'), { recursive: true });
  execFileSync(process.execPath, ['--test', '--experimental-test-coverage', '--test-reporter=lcov',
    '--test-reporter-destination=coverage/lcov.info', testFile], { cwd: dir, env, stdio: ['ignore', 'ignore', 'ignore'] });
}

test('with a real Node lcov, editing a long test title or adding an export parameter is not new code', (t) => {
  const dir = init(t);
  const exported = (params) => `exports.build = function (${params}) {\n${body(88)}\n  return a;\n};\n`;
  const suite = (title) => `const { test } = require('node:test');\nconst m = require('../src/e.js');\ntest('${title}', () => {\n${body(88)}\n  m.build(1);\n});\n`;
  write(dir, 'src/e.js', exported('a'));
  write(dir, 't/a.test.js', suite('old title'));
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'base']);
  git(dir, ['checkout', '-q', '-b', 'feat']);
  write(dir, 'src/e.js', exported('a, b'));
  write(dir, 't/a.test.js', suite('new title'));
  realLcov(dir, 't/a.test.js');
  const result = evaluateComplexity({ root: dir, config: ENFORCED });

  assert.match(fs.readFileSync(path.join(dir, 'coverage/lcov.info'), 'utf8'), /FN:\d+,anonymous_0/);
  assert.deepStrictEqual(grown(result), []);
  assert.equal(result.ok, true);
});

test('qualified, default and constructor names are found on their replaced start line', (t) => {
  const cls = (params) => `class K {\n  constructor(${params}) {\n${body(88, '    ')}\n  }\n}\nmodule.exports.run = function (${params}) {\n${body(88)}\n};\n`;
  const result = evaluate(t, { 'src/k.js': cls('a') }, (dir) => write(dir, 'src/k.js', cls('a, b')),
    { 'src/k.js': [[2, 'K'], [93, 'module.exports.run']] });

  assert.deepStrictEqual(grown(result), []);
});

test('a new anonymous test inserted in a hunk that edits the line above is new, not the test below it', (t) => {
  const test = (title, n) => `test('${title}', () => {\n${body(n)}\n});\n`;
  const result = evaluate(t, { 't/b.test.js': `// t\n${test('a', 118)}` },
    (dir) => write(dir, 't/b.test.js', `// t2\n${test('n', 98)}${test('a', 118)}`),
    { 't/b.test.js': [[2, 'anonymous_0'], [102, 'anonymous_1']] });

  assert.deepStrictEqual(grown(result), ['t/b.test.js anonymous_0 0→100']);
});

test('a new function does not borrow the length of a same-named one that was only edited', (t) => {
  const run = (params, n) => `function run(${params}) {\n${body(n - 2)}\n}\n`;
  const result = evaluate(t, { 'src/a.js': run('a', 150), 'src/b.js': '// b\n' }, (dir) => {
    write(dir, 'src/a.js', run('a, b', 150));
    write(dir, 'src/b.js', `// b\n${run('', 100)}`);
  }, { 'src/a.js': [[1, 'run']], 'src/b.js': [[2, 'run']] });

  assert.deepStrictEqual(grown(result), ['src/b.js run 0→100']);
});

test('two anonymous functions never claim the same replaced start: the new one above is new', (t) => {
  const test = (title, n) => `test('${title}', () => {\n${body(n)}\n});\n`;
  const result = evaluate(t, { 't/c.test.js': test('a', 118) },
    (dir) => write(dir, 't/c.test.js', `${test('n', 98)}${test('a2', 118)}`),
    { 't/c.test.js': [[1, 'anonymous_0'], [101, 'anonymous_1']] });

  assert.deepStrictEqual(grown(result), ['t/c.test.js anonymous_0 0→100']);
  assert.equal(result.ok, false);
});
