'use strict';

// Story 14-07: `verify` reads the lcov its own commands wrote and reports a
// touched function that grew past `functionSize.max` (or whose CRAP crossed 30)
// as `complexity-grew` — a warning, or a failure under `functionSize.enforce`.
// Driven through the CLI on throwaway repositories.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'ignore', 'ignore'] });
}

function write(dir, file, content) {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), content);
}

function run(cwd, args) {
  try {
    return { code: 0, output: execFileSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (err) {
    return { code: err.status ?? 1, output: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

function latestVerify(dir) {
  const runs = path.join(dir, '.coding-flow', 'runs');
  const name = fs.readdirSync(runs).filter((f) => f.endsWith('-verify.json')).sort().pop();
  return JSON.parse(fs.readFileSync(path.join(runs, name), 'utf8'));
}

// `function <name>() {` + `lines - 2` statements + `}`: exactly `lines` lines.
function fn(name, lines) {
  const inner = Array.from({ length: lines - 2 }, (_, i) => `  const v${i} = ${i};`);
  return [`function ${name}() {`, ...inner, '}', ''].join('\n');
}

// The validation command: an lcov naming `build` at line 1, every line executed.
const WRITE_LCOV = `
const fs = require("fs");
const lines = fs.readFileSync("src/fn.js", "utf8").split("\\n").length - 1;
fs.mkdirSync("coverage", { recursive: true });
const da = Array.from({ length: lines }, (_, i) => "DA:" + (i + 1) + ",1");
fs.writeFileSync("coverage/lcov.info", ["SF:src/fn.js", "FN:1,build", ...da, "end_of_record", ""].join("\\n"));
`;

function repo(t, { lines = 85, harness = null, command = 'node write-lcov.js' } = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-complexity-signal-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  write(dir, '.gitignore', 'coverage/\n.coding-flow/runs/\n');
  write(dir, 'src/fn.js', fn('build', lines));
  write(dir, 'write-lcov.js', WRITE_LCOV);
  write(dir, '.coding-flow/config.json', JSON.stringify({ validation: { commands: [command] } }));
  if (harness) write(dir, '.coding-flow/harness.json', JSON.stringify({ version: 1, ...harness }));
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'base']);
  git(dir, ['checkout', '-q', '-b', 'feat/grow']);
  return dir;
}

function grow(dir, lines = 90) {
  write(dir, 'src/fn.js', fn('build', lines));
  git(dir, ['commit', '-qam', 'grow build']);
}

test('an 85-line function grown to 90 is a complexity-grew warning, and verify passes', (t) => {
  const dir = repo(t);
  grow(dir);

  const res = run(dir, ['verify']);

  assert.equal(res.code, 0, res.output);
  assert.match(res.output, /passed, with warnings \(.*1 function grew \(heuristic\)/);
  assert.match(res.output, /Complexity grew: warning — heuristic/);
  assert.match(res.output, /src\/fn\.js:1 build 85→90 lines/);

  const { complexity, ok } = latestVerify(dir);
  assert.equal(ok, true);
  assert.equal(complexity.signal, 'complexity-grew');
  assert.equal(complexity.heuristic, true);
  assert.equal(complexity.enforced, false);
  assert.deepStrictEqual(complexity.items.map((item) => [item.name, item.length.before, item.length.after]), [['build', 85, 90]]);
});

test('with functionSize.enforce: true the same growth fails verify', (t) => {
  const dir = repo(t, { harness: { functionSize: { enforce: true } } });
  grow(dir);

  const res = run(dir, ['verify']);

  assert.equal(res.code, 1, res.output);
  assert.match(res.output, /NOT PROVEN — 1 command\(s\) passed, but a touched function grew \(functionSize\.enforce\)/);
  assert.match(res.output, /src\/fn\.js:1 build 85→90 lines/);
  assert.equal(latestVerify(dir).ok, false);
});

test('a function shrinking while above the line, or growing below it, is not reported', (t) => {
  const dir = repo(t, { lines: 70, harness: { functionSize: { enforce: true } } });
  grow(dir, 78);

  const res = run(dir, ['verify']);

  assert.equal(res.code, 0, res.output);
  assert.deepStrictEqual(latestVerify(dir).complexity.items, []);
});

test('functionSize.max moves the line', (t) => {
  const dir = repo(t, { lines: 30, harness: { functionSize: { max: 40, enforce: true } } });
  grow(dir, 45);

  const res = run(dir, ['verify']);

  assert.equal(res.code, 1, res.output);
  assert.match(res.output, /build 30→45 lines/);
});

test('a touched function whose CRAP crosses 30 is reported', (t) => {
  // Six uncovered branch lines: c = 7, CRAP = 49 + 7 = 56. At the base none of
  // them existed and what remains is uncovered: c = 1, CRAP = 1 + 1 = 2.
  const writer = WRITE_LCOV.replace(
    '"FN:1,build", ...da,',
    '"FN:1,build", ...da.map((r) => r.replace(/,1$/, ",0")), ...[2,3,4,5,6,7].map((l) => "BRDA:" + l + ",0,0,0"),',
  );
  const dir = repo(t, { lines: 10 });
  write(dir, 'write-lcov.js', writer);
  git(dir, ['commit', '-qam', 'uncovered report']);
  const body = ['function build(x) {', ...[0, 1, 2, 3, 4, 5].map((i) => `  if (x === ${i}) return ${i};`), '  return -1;', '}', ''];
  write(dir, 'src/fn.js', body.join('\n'));
  git(dir, ['commit', '-qam', 'branches']);

  const res = run(dir, ['verify', '--test-exemption', 'fixture: the report is hand-written']);

  assert.match(res.output, /src\/fn\.js:1 build CRAP 2→56/, res.output);
  assert.deepStrictEqual(latestVerify(dir).complexity.items[0].reasons, ['crap']);
});

test('with no lcov written by the run, verify emits no complexity signal', (t) => {
  const dir = repo(t, { command: 'node -e "process.exit(0)"', harness: { requireTestChange: false } });
  grow(dir);

  const res = run(dir, ['verify']);

  assert.equal(res.code, 0, res.output);
  assert.doesNotMatch(res.output, /Complexity/);
  assert.equal(latestVerify(dir).complexity, undefined);
});

test('under functionSize.enforce, no lcov is a check that did not run, never a pass', (t) => {
  const dir = repo(t, { command: 'node -e "process.exit(0)"', harness: { functionSize: { enforce: true }, requireTestChange: false } });
  grow(dir);

  const res = run(dir, ['verify']);

  assert.equal(res.code, 1, res.output);
  assert.match(res.output, /Complexity: not checked — this run wrote no lcov that lists a function/);
  assert.equal(latestVerify(dir).complexity.ok, false);
});

test('an lcov left over from before the run is not read', (t) => {
  const dir = repo(t, { command: 'node -e "process.exit(0)"', harness: { requireTestChange: false } });
  grow(dir);
  execFileSync(process.execPath, ['write-lcov.js'], { cwd: dir });
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(path.join(dir, 'coverage', 'lcov.info'), old, old);

  run(dir, ['verify']);

  assert.equal(latestVerify(dir).complexity, undefined);
});

// --- the review's reproductions (14-07): each was a wrong verdict under enforce --

const { evaluateComplexity } = require('../bin/lib/complexity');

// A repository at `base` files, branched, then edited by `edit(dir)`; the lcov is
// written last, listing `fns` with every line executed and `branches` as BRDA.
function evaluate(t, files, edit, lcovFor, overrides = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-complexity-review-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  write(dir, '.gitignore', 'coverage/\n');
  for (const [file, content] of Object.entries(files)) write(dir, file, content);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'base']);
  git(dir, ['checkout', '-q', '-b', 'feat']);
  edit(dir);
  const records = Object.entries(lcovFor).map(([file, { fns, branches = [] }]) => {
    const count = fs.readFileSync(path.join(dir, file), 'utf8').split('\n').length - 1;
    return [`SF:${file}`, ...fns.map(([line, name]) => `FN:${line},${name}`),
      ...Array.from({ length: count }, (_, i) => `DA:${i + 1},1`), ...branches.map((line) => `BRDA:${line},0,0,1`), 'end_of_record'];
  });
  write(dir, 'coverage/lcov.info', [...records.flat(), ''].join('\n'));

  return evaluateComplexity({ root: dir, config: { coverageReports: ['coverage/lcov.info'], functionSize: { max: 80, enforce: true }, ...overrides } });
}

const grown = (result) => result.items.map((item) => `${item.name} ${item.length.before}→${item.length.after} ${item.reasons}`);

test('a moved file is not read as a new 100-line function', (t) => {
  const result = evaluate(t, { 'src/a.js': fn('build', 100) }, (dir) => git(dir, ['mv', 'src/a.js', 'src/b.js']),
    { 'src/b.js': { fns: [[1, 'build']] } });

  assert.deepStrictEqual(grown(result), []);
  assert.equal(result.ok, true);
});

test('an unreadable untracked file does not switch the check off', (t) => {
  const result = evaluate(t, { 'src/a.js': fn('build', 85) }, (dir) => {
    write(dir, 'src/a.js', fn('build', 95));
    fs.symlinkSync('/nonexistent/target', path.join(dir, 'dangling'));
  }, { 'src/a.js': { fns: [[1, 'build']] } });

  assert.deepStrictEqual(grown(result), ['build 85→95 length']);
  assert.equal(result.ok, false);
});

test('a hunk that also edits the line above a long function does not make it grow', (t) => {
  const result = evaluate(t, { 'src/a.js': `// doc\n${fn('build', 100)}` },
    (dir) => write(dir, 'src/a.js', `// doc changed\n${fn('build', 100).replace('build()', 'build(x)')}`),
    { 'src/a.js': { fns: [[2, 'build']] } });

  assert.deepStrictEqual(grown(result), []);
});

test('a hunk that grows a function and deletes the code after it is still growth', (t) => {
  const statements = (prefix, n) => Array.from({ length: n }, (_, i) => `  const ${prefix}${i} = ${i};`);
  const base = ['function build() {', ...statements('v', 73), '}', ...Array.from({ length: 11 }, (_, i) => `let t${i} = ${i};`), ''].join('\n');
  const after = ['function build() {', ...statements('v', 73), ...statements('w', 6), '} // grown', ''].join('\n');
  const result = evaluate(t, { 'src/a.js': base }, (dir) => write(dir, 'src/a.js', after), { 'src/a.js': { fns: [[1, 'build']] } });

  assert.deepStrictEqual(grown(result), ['build 75→81 length']);
});

test('editing two existing conditions is not new complexity', (t) => {
  const body = (k) => ['function route(x) {', ...Array.from({ length: 31 }, (_, i) => `  if (x === ${i === 0 ? k : i}) return ${i};`), '  return -1;', '}', ''].join('\n');
  const branches = Array.from({ length: 31 }, (_, i) => i + 2);
  const result = evaluate(t, { 'src/a.js': body(0) },
    (dir) => write(dir, 'src/a.js', body(100).replace('=== 1)', '=== 101)')), { 'src/a.js': { fns: [[1, 'route']], branches } });

  assert.deepStrictEqual(grown(result), []);
});

test('a TypeScript return type or generic constraint does not hide the body', (t) => {
  const result = evaluate(t, {
    'src/a.ts': fn('build', 85).replace('build()', 'build(): { a: number }'),
    'src/b.ts': fn('make', 85).replace('make()', 'make<T extends { id: string }>(x: T): Promise<{ ok: true }>'),
  }, (dir) => {
    write(dir, 'src/a.ts', fn('build', 95).replace('build()', 'build(): { a: number }'));
    write(dir, 'src/b.ts', fn('make', 95).replace('make()', 'make<T extends { id: string }>(x: T): Promise<{ ok: true }>'));
  }, { 'src/a.ts': { fns: [[1, 'build']] }, 'src/b.ts': { fns: [[1, 'make']] } });

  assert.deepStrictEqual(grown(result).sort(), ['build 85→95 length', 'make 85→95 length']);
});

test('this repository enforces functionSize, which replaced the 13-06 script', () => {
  const root = path.join(__dirname, '..');
  const harness = JSON.parse(fs.readFileSync(path.join(root, '.coding-flow', 'harness.json'), 'utf8'));
  const config = fs.readFileSync(path.join(root, '.coding-flow', 'config.json'), 'utf8');

  assert.deepStrictEqual(harness.functionSize, { max: 80, enforce: true });
  assert.doesNotMatch(config, /check-function-size/);
});

test('under enforce, a touched file the lcov does not list is unlisted, and not a pass', (t) => {
  const result = evaluate(t, { 'src/a.js': fn('build', 10), 'test/a.test.js': '// t\n', 'README.md': '# r\n' }, (dir) => {
    write(dir, 'src/new.js', fn('huge', 200));
    write(dir, 'test/a.test.js', '// t\n// more\n');
    write(dir, 'README.md', '# r\nmore\n');
  }, { 'src/a.js': { fns: [[1, 'build']] } }, { testGlobs: ['test/**'] });

  assert.deepStrictEqual(result.unlisted, ['src/new.js']);
  assert.equal(result.ok, false);
});

test('a loaded file that lists no function is not reported as unlisted', (t) => {
  const result = evaluate(t, { 'src/a.js': fn('build', 10), 'src/data.js': 'module.exports = 1;\n' },
    (dir) => write(dir, 'src/data.js', 'module.exports = 2;\nmodule.exports.b = 3;\n'),
    { 'src/a.js': { fns: [[1, 'build']] }, 'src/data.js': { fns: [] } });

  assert.deepStrictEqual(result.unlisted, []);
  assert.equal(result.ok, true);
});

test('an unusable functionSize.max is named, and 80 lines is used', (t) => {
  const result = evaluate(t, { 'src/a.js': fn('build', 85) }, (dir) => write(dir, 'src/a.js', fn('build', 90)),
    { 'src/a.js': { fns: [[1, 'build']] } }, { functionSize: { max: '100', enforce: true } });

  assert.equal(result.invalidMax, '100');
  assert.equal(result.max, 80);
  assert.deepStrictEqual(grown(result), ['build 85→90 length']);
});

test('an unusable functionSize.max never loosens what it meant: "40" is held at 40', (t) => {
  const result = evaluate(t, { 'src/a.js': fn('build', 45) }, (dir) => write(dir, 'src/a.js', fn('build', 50)),
    { 'src/a.js': { fns: [[1, 'build']] } }, { functionSize: { max: '40', enforce: true } });

  assert.equal(result.invalidMax, '40');
  assert.equal(result.max, 40);
  assert.deepStrictEqual(grown(result), ['build 45→50 length']);
});

test('a touched file in a package no report speaks for is not unlisted (as in the coverage gate)', (t) => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-complexity-packages-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  write(dir, '.gitignore', 'coverage/\n');
  write(dir, 'package.json', '{"workspaces":["packages/*"]}\n');
  write(dir, 'packages/a/package.json', '{}\n');
  write(dir, 'packages/b/package.json', '{}\n');
  write(dir, 'packages/a/src/a.js', fn('build', 10));
  write(dir, 'packages/b/src/b.js', fn('other', 10));
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'base']);
  git(dir, ['checkout', '-q', '-b', 'feat']);
  write(dir, 'packages/a/src/new.js', fn('fresh', 10));
  write(dir, 'packages/b/src/b.js', fn('other', 12));
  write(dir, 'packages/a/coverage/lcov.info', ['SF:src/a.js', 'FN:1,build', 'DA:1,1', 'end_of_record', ''].join('\n'));

  const result = evaluateComplexity({ root: dir, config: { coverageReports: ['packages/*/coverage/lcov.info'], functionSize: { enforce: true } } });

  assert.deepStrictEqual(result.unlisted, ['packages/a/src/new.js']);
});
