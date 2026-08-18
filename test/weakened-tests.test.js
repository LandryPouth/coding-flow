'use strict';

// The `evidence` rung is earned when a behaviour file and a test file both appear
// in the diff. The direction of the test change used to go unread, so the cheapest
// way past the gate was to touch a test — and deleting an assertion, adding
// `.skip`, or removing the file outright all count as touching one.
//
// These tests pin both halves of the fix: a diff whose test changes are only
// weakening does not earn the rung, and a diff that genuinely strengthens a test
// still does. The false-positive cases matter as much as the firing ones — a gate
// that fires on a legitimate refactor is a gate people switch off.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');

function run(cwd, args) {
  try {
    return { code: 0, output: execFileSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (err) {
    return { code: err.status ?? 1, output: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

const git = (cwd, args) => execFileSync('git', args, { cwd, stdio: ['ignore', 'ignore', 'ignore'] });

function write(dir, files) {
  for (const [name, content] of Object.entries(files)) {
    const full = path.join(dir, name);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
}

const BASELINE_TEST = `test('adds', () => {
  expect(add(1, 2)).toBe(3);
  expect(add(0, 0)).toBe(0);
  expect(add(-1, 1)).toBe(0);
});
`;

// A repository whose feature branch starts from a main that ALREADY has a test
// file — the only shape in which "the test got weaker" is a thing the diff can
// show at all.
function repo(t, prefix) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `coding-flow-${prefix}-`)));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  assert.equal(run(dir, ['init']).code, 0);

  const configPath = path.join(dir, '.coding-flow', 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.validation = { commands: ['node -e "process.exit(0)"'], quality: [] };
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

  git(dir, ['init', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  write(dir, { 'src/math.test.js': BASELINE_TEST, 'src/math.js': 'const add = (a, b) => a + b;\n' });
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-m', 'init']);
  git(dir, ['checkout', '-b', 'feat/story']);

  return dir;
}

function story(dir) {
  const rel = 'epics/epic-01/story-01-01-demo';
  fs.mkdirSync(path.join(dir, rel), { recursive: true });
  write(dir, {
    [`${rel}/spec.md`]: '# Demo\n\nChange who is allowed through: this story alters an authorization decision.\n',
    [`${rel}/plan.md`]: '# Plan\n',
  });
  return rel;
}

function commit(dir, files, message) {
  write(dir, files);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-m', message]);
}

const BEHAVIOR = { 'src/auth.js': 'module.exports = () => true;\n' };

// --- weakening withholds the rung -------------------------------------------

test('deleting a test file does not count as covering the change', (t) => {
  const dir = repo(t, 'weak-delete');
  const rel = story(dir);
  write(dir, BEHAVIOR);
  fs.rmSync(path.join(dir, 'src', 'math.test.js'));
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-m', 'auth change, test removed']);

  const res = run(dir, ['verify', '--story', rel]);

  assert.equal(res.code, 1, 'removing the test must not earn the rung');
  assert.match(res.output, /NOT PROVEN/);
  assert.match(res.output, /Tests weakened in this diff/);
  assert.match(res.output, /src\/math\.test\.js: the test file was removed/);
});

test('adding .skip does not count as covering the change', (t) => {
  const dir = repo(t, 'weak-skip');
  const rel = story(dir);
  commit(dir, { ...BEHAVIOR, 'src/math.test.js': BASELINE_TEST.replace('test(', 'test.skip(') }, 'skip it');

  const res = run(dir, ['verify', '--story', rel]);

  assert.equal(res.code, 1);
  assert.match(res.output, /NOT PROVEN/);
  assert.match(res.output, /skip\/only marker\(s\) added/);
});

test('.only counts as weakening, because it silences every other test', (t) => {
  const dir = repo(t, 'weak-only');
  const rel = story(dir);
  commit(dir, { ...BEHAVIOR, 'src/math.test.js': BASELINE_TEST.replace('test(', 'test.only(') }, 'only it');

  const res = run(dir, ['verify', '--story', rel]);

  assert.equal(res.code, 1);
  assert.match(res.output, /skip\/only marker\(s\) added/);
});

test('removing assertions does not count as covering the change', (t) => {
  const dir = repo(t, 'weak-assertions');
  const rel = story(dir);
  const gutted = "test('adds', () => {\n  expect(add(1, 2)).toBe(3);\n});\n";
  commit(dir, { ...BEHAVIOR, 'src/math.test.js': gutted }, 'gut the test');

  const res = run(dir, ['verify', '--story', rel]);

  assert.equal(res.code, 1);
  assert.match(res.output, /more assertion\(s\) removed than added/);
});

// --- and it must not fire on honest work ------------------------------------

test('a strengthened test still earns the rung', (t) => {
  const dir = repo(t, 'weak-strong');
  const rel = story(dir);
  const stronger = `${BASELINE_TEST}\ntest('rejects', () => {\n  expect(add(1, 1)).toBe(2);\n});\n`;
  commit(dir, { ...BEHAVIOR, 'src/math.test.js': stronger }, 'add a case');

  const res = run(dir, ['verify', '--story', rel]);

  assert.equal(res.code, 0, res.output);
  assert.match(res.output, /test file\(s\) strengthened/);
  assert.doesNotMatch(res.output, /Tests weakened/);
});

test('a neutral edit is not a weakening', (t) => {
  const dir = repo(t, 'weak-neutral');
  const rel = story(dir);
  // Same assertions, renamed test: direction is what is read, not effort.
  commit(dir, { ...BEHAVIOR, 'src/math.test.js': BASELINE_TEST.replace("'adds'", "'adds two numbers'") }, 'rename');

  const res = run(dir, ['verify', '--story', rel]);

  assert.equal(res.code, 0, res.output);
  assert.doesNotMatch(res.output, /Tests weakened/);
});

test('one weakened file does not cancel a genuinely strengthened one — but it is still reported', (t) => {
  const dir = repo(t, 'weak-mixed');
  const rel = story(dir);
  commit(dir, {
    ...BEHAVIOR,
    'src/math.test.js': "test('adds', () => {\n  expect(add(1, 2)).toBe(3);\n});\n",
    'src/auth.test.js': "test('denies anonymous', () => {\n  expect(auth()).toBe(true);\n});\n",
  }, 'new auth test, trimmed math test');

  const res = run(dir, ['verify', '--story', rel]);

  assert.equal(res.code, 0, res.output);
  assert.match(res.output, /strengthened/, 'the real test still earns the rung');
  assert.match(res.output, /Tests weakened in this diff/, 'and the trimmed one is still surfaced');
});

test('the weakening is recorded in the evidence, not only printed', (t) => {
  const dir = repo(t, 'weak-evidence');
  const rel = story(dir);
  commit(dir, { ...BEHAVIOR, 'src/math.test.js': BASELINE_TEST.replace('test(', 'test.skip(') }, 'skip it');

  run(dir, ['verify', '--story', rel]);

  const runsDir = path.join(dir, '.coding-flow', 'runs');
  const file = fs.readdirSync(runsDir).filter((name) => name.endsWith('-verify.json')).sort().pop();
  const evidence = JSON.parse(fs.readFileSync(path.join(runsDir, file), 'utf8'));

  assert.ok(Array.isArray(evidence.coverage.weakenedTests), 'the findings travel with the proof');
  assert.equal(evidence.coverage.weakenedTests[0].signal, 'skipped');
});

test('a declared exemption still carries the weakening it excused', (t) => {
  const dir = repo(t, 'weak-exempt');
  const rel = story(dir);
  commit(dir, { ...BEHAVIOR, 'src/math.test.js': BASELINE_TEST.replace('test(', 'test.skip(') }, 'skip it');

  const res = run(dir, ['verify', '--story', rel, '--test-exemption', 'flaky in CI, tracked in #12']);

  assert.equal(res.code, 0, res.output);
  assert.match(res.output, /Tests weakened in this diff/, 'an exemption excuses the gate, it does not erase the fact');
});
