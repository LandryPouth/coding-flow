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
  const dir = repo(t, { command: 'node -e "process.exit(0)"', harness: { functionSize: { enforce: true }, requireTestChange: false } });
  grow(dir);

  const res = run(dir, ['verify']);

  assert.doesNotMatch(res.output, /Complexity grew/);
  assert.equal(latestVerify(dir).complexity, undefined);
});

test('an lcov left over from before the run is not read', (t) => {
  const dir = repo(t, { command: 'node -e "process.exit(0)"', harness: { functionSize: { enforce: true }, requireTestChange: false } });
  grow(dir);
  execFileSync(process.execPath, ['write-lcov.js'], { cwd: dir });
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(path.join(dir, 'coverage', 'lcov.info'), old, old);

  run(dir, ['verify']);

  assert.equal(latestVerify(dir).complexity, undefined);
});

test('this repository enforces functionSize, which replaced the 13-06 script', () => {
  const root = path.join(__dirname, '..');
  const harness = JSON.parse(fs.readFileSync(path.join(root, '.coding-flow', 'harness.json'), 'utf8'));
  const config = fs.readFileSync(path.join(root, '.coding-flow', 'config.json'), 'utf8');

  assert.deepStrictEqual(harness.functionSize, { max: 80, enforce: true });
  assert.doesNotMatch(config, /check-function-size/);
});
