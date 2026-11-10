'use strict';

// Story 14-03: a fix is proven by a test that was red at base. Every test drives
// a real throwaway repository through the CLI: two worktrees (merge base and
// HEAD), the HEAD test files copied into the base one, the targeted command run
// in both. The assertions are the observable ones: exit codes, the evidence, and
// no worktree left behind.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function repo(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `coding-flow-${prefix}-`));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'red-at-base@example.com']);
  git(dir, ['config', 'user.name', 'Red At Base']);
  fs.writeFileSync(path.join(dir, '.gitignore'), '.coding-flow/\n');
  return dir;
}

function project(t, prefix) {
  const dir = repo(t, prefix);
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'red-at-base-fixture', scripts: { test: 'node --test' } }, null, 2),
  );
  return dir;
}

function commit(dir, message) {
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', message]);
}

function harnessConfig(dir, redAtBase) {
  const configDir = path.join(dir, '.coding-flow');
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'harness.json'), JSON.stringify({ version: 1, redAtBase }, null, 2));
}

function run(dir, args, extraEnv = {}) {
  const env = { ...process.env, CI: '', AI_FLOW_FORCE_TTY: '1', NODE_ENV: 'test', ...extraEnv };
  // The outer suite runs under `node --test`; leaving its marker in the child
  // makes the fixture's own `node --test` answer "already inside a test file"
  // and skip the files, which would make every verdict meaningless.
  delete env.NODE_TEST_CONTEXT;

  try {
    const output = execFileSync(process.execPath, [CLI, ...args], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
    });
    return { code: 0, output };
  } catch (err) {
    return { code: err.status ?? 1, output: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

function verify(dir, extra = [], extraEnv = {}) {
  const { code, output } = run(dir, ['verify', '--red-at-base', '--json', ...extra], extraEnv);
  return { code, output, evidence: JSON.parse(output) };
}

function worktreeCount(dir) {
  return git(dir, ['worktree', 'list', '--porcelain']).split(/\n\n+/).filter(Boolean).length;
}

function writeTest(dir, body, file = path.join('test', 'math.test.js')) {
  const full = path.join(dir, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
}

function buggyBase(t) {
  const dir = project(t, 'red-base');
  fs.writeFileSync(
    path.join(dir, 'math.js'),
    'function add(a, b) {\n  return a - b;\n}\n\nmodule.exports = { add };\n',
  );
  commit(dir, 'base: add() subtracts');
  git(dir, ['checkout', '-q', '-b', 'fix']);
  return dir;
}

function fixed(dir) {
  fs.writeFileSync(
    path.join(dir, 'math.js'),
    'function add(a, b) {\n  return a + b;\n}\n\nmodule.exports = { add };\n',
  );
}

const ADDING_TEST = [
  "const test = require('node:test');",
  "const assert = require('node:assert');",
  "const { add } = require('../math');",
  '',
  "test('adds two numbers', () => {",
  '  assert.equal(add(2, 3), 5);',
  '});',
  '',
].join('\n');

test('a test committed with the fix passes only when it is red at base', (t) => {
  const dir = buggyBase(t);
  writeTest(dir, ADDING_TEST);
  fixed(dir);
  commit(dir, 'fix: add() adds, with a test');
  harnessConfig(dir, { command: 'node --test --test-reporter=tap {files}' });

  const { code, output, evidence } = verify(dir);

  assert.equal(code, 0, output);
  assert.equal(evidence.ok, true);
  assert.equal(evidence.redAtBase.ok, true);
  assert.notEqual(evidence.redAtBase.baseExit, 0);
  assert.equal(evidence.redAtBase.headExit, 0);
  assert.deepStrictEqual(evidence.redAtBase.files, ['test/math.test.js']);
  assert.equal(worktreeCount(dir), 1);
  assert.equal(git(dir, ['status', '--porcelain']), '', 'the user tree is unchanged');
  assert.equal(git(dir, ['stash', 'list']), '', 'the user stash is untouched');
});

test('a test that passes without the fix does not demonstrate the finding', (t) => {
  const dir = project(t, 'red-passes');
  fs.writeFileSync(path.join(dir, 'math.js'), 'function add(a, b) {\n  return a + b;\n}\n\nmodule.exports = { add };\n');
  commit(dir, 'base: add() is correct');
  git(dir, ['checkout', '-q', '-b', 'fix']);
  writeTest(dir, ADDING_TEST);
  fs.writeFileSync(path.join(dir, 'math.js'), '// adds\nfunction add(a, b) {\n  return a + b;\n}\n\nmodule.exports = { add };\n');
  commit(dir, 'test: add a test that already passes, with an unrelated code edit');
  harnessConfig(dir, { command: 'node --test --test-reporter=tap {files}' });

  const { code, output, evidence } = verify(dir);

  assert.notEqual(code, 0, output);
  assert.equal(evidence.ok, false);
  assert.equal(evidence.redAtBase.ok, false);
  assert.equal(evidence.redAtBase.baseExit, 0);
  assert.match(evidence.redAtBase.reason, /does not demonstrate/i);
  assert.equal(worktreeCount(dir), 1);
});

test('a helper added in the diff is refused before the trees are built', (t) => {
  const dir = buggyBase(t);
  fs.writeFileSync(
    path.join(dir, 'expect-five.js'),
    "module.exports = { expected: 5 };\n",
  );
  writeTest(dir, [
    "const test = require('node:test');",
    "const assert = require('node:assert');",
    "const { add } = require('../math');",
    "const { expected } = require('../expect-five');",
    '',
    "test('adds two numbers', () => {",
    '  assert.equal(add(2, 3), expected);',
    '});',
    '',
  ].join('\n'));
  fixed(dir);
  commit(dir, 'fix: add() adds, test uses a helper added here');
  harnessConfig(dir, { command: 'node --test --test-reporter=tap {files}' });

  const { code, output, evidence } = verify(dir);

  assert.notEqual(code, 0, output);
  assert.equal(evidence.redAtBase.ok, false);
  assert.equal(evidence.redAtBase.baseExit, null);
  assert.match(evidence.redAtBase.reason, /cannot run in a clean tree/i);
  assert.match(evidence.redAtBase.reason, /non-test files/i);
  assert.equal(worktreeCount(dir), 1);
});

test('no redAtBase.command names the key and shows the node example', (t) => {
  const dir = buggyBase(t);
  writeTest(dir, ADDING_TEST);
  fixed(dir);
  commit(dir, 'fix: add() adds, with a test');

  const { code, output, evidence } = verify(dir);

  assert.notEqual(code, 0, output);
  assert.equal(evidence.redAtBase.ok, false);
  assert.match(evidence.redAtBase.reason, /redAtBase\.command/);
  assert.match(evidence.redAtBase.reason, /node --test --test-reporter=tap \{files\}/);
  assert.doesNotMatch(evidence.redAtBase.reason, /jest|vitest|go test/i);
  assert.equal(worktreeCount(dir), 1);
});

test('a thrown error mid-run still removes both worktrees', (t) => {
  const dir = buggyBase(t);
  writeTest(dir, ADDING_TEST);
  fixed(dir);
  commit(dir, 'fix: add() adds, with a test');

  const { readHarnessConfig } = require('../bin/lib/harness-config');
  const { runRedAtBase } = require('../bin/lib/red-at-base');
  const config = { ...readHarnessConfig(dir).config, redAtBase: { command: 'node --test --test-reporter=tap {files}' } };
  let calls = 0;

  const result = runRedAtBase({
    root: dir,
    config,
    runCommand: () => {
      calls += 1;
      if (calls === 2) {
        throw new Error('injected crash while running the HEAD side');
      }
      return { ok: false, exitCode: 1, durationMs: 1, stdoutTail: 'not ok 1', stderrTail: '', failureLines: [] };
    },
  });

  assert.equal(result.ok, false);
  assert.match(result.reason, /injected crash/);
  assert.equal(worktreeCount(dir), 1);
});

test('a branch with no test file has nothing to be red', (t) => {
  const dir = buggyBase(t);
  fixed(dir);
  commit(dir, 'fix: add() adds, without a test');
  harnessConfig(dir, { command: 'node --test --test-reporter=tap {files}' });

  const { code, output, evidence } = verify(dir);

  assert.notEqual(code, 0, output);
  assert.equal(evidence.redAtBase.ok, false);
  assert.match(evidence.redAtBase.reason, /nothing to be red/i);
  assert.equal(worktreeCount(dir), 1);
});

test('an uncommitted test is refused before any worktree is created', (t) => {
  const dir = buggyBase(t);
  writeTest(dir, ADDING_TEST);
  fixed(dir);
  commit(dir, 'fix: add() adds, with a test');
  harnessConfig(dir, { command: 'node --test --test-reporter=tap {files}' });
  fs.appendFileSync(path.join(dir, 'test/math.test.js'), '\n// uncommitted\n');

  const { code, output, evidence } = verify(dir);

  assert.notEqual(code, 0, output);
  assert.equal(evidence.redAtBase.ok, false);
  assert.match(evidence.redAtBase.reason, /not committed at HEAD/i);
  assert.equal(worktreeCount(dir), 1);
});

test('a failure while setting up the trees still removes them', (t) => {
  const dir = buggyBase(t);
  writeTest(dir, ADDING_TEST);
  fixed(dir);
  commit(dir, 'fix: add() adds, with a test');

  const { readHarnessConfig } = require('../bin/lib/harness-config');
  const { runRedAtBase } = require('../bin/lib/red-at-base');
  const config = { ...readHarnessConfig(dir).config, redAtBase: { command: 'node --test --test-reporter=tap {files}' } };
  const original = fs.copyFileSync;

  fs.copyFileSync = () => {
    throw new Error('injected copy failure');
  };

  try {
    const result = runRedAtBase({ root: dir, config });

    assert.equal(result.ok, false);
    assert.match(result.reason, /injected copy failure/);
  } finally {
    fs.copyFileSync = original;
  }

  assert.equal(worktreeCount(dir), 1);
});

test('a base-tree symlink at the test path is replaced, not followed', (t) => {
  const dir = buggyBase(t);
  const victimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-red-victim-'));
  t.after(() => fs.rmSync(victimDir, { recursive: true, force: true }));
  const victim = path.join(victimDir, 'victim.txt');
  fs.writeFileSync(victim, 'ORIGINAL CONTENT');
  fs.mkdirSync(path.join(dir, 'test'), { recursive: true });
  fs.symlinkSync(victim, path.join(dir, 'test', 'math.test.js'));
  commit(dir, 'base: the test path is a symlink');
  fs.unlinkSync(path.join(dir, 'test', 'math.test.js'));
  writeTest(dir, ADDING_TEST);
  fixed(dir);
  commit(dir, 'fix: add() adds, with a real test');
  harnessConfig(dir, { command: 'node --test --test-reporter=tap {files}' });

  const { code, output, evidence } = verify(dir);

  assert.equal(code, 0, output);
  assert.equal(evidence.redAtBase.ok, true);
  assert.equal(fs.readFileSync(victim, 'utf8'), 'ORIGINAL CONTENT');
  assert.equal(worktreeCount(dir), 1);
});

test('a cached proof made without the flag cannot satisfy --red-at-base', (t) => {
  const dir = buggyBase(t);
  writeTest(dir, ADDING_TEST);
  fixed(dir);
  commit(dir, 'fix: add() adds, with a test');
  harnessConfig(dir, { command: 'node --test --test-reporter=tap {files}' });

  const first = run(dir, ['verify', '--json']);
  assert.equal(first.code, 0, first.output);

  const second = verify(dir);

  assert.equal(second.code, 0, second.output);
  assert.equal(second.evidence.reused, undefined);
  assert.equal(second.evidence.redAtBase.ok, true);
});

test('--clean-env reaches the targeted command too', (t) => {
  const dir = buggyBase(t);
  writeTest(dir, ADDING_TEST);
  fixed(dir);
  commit(dir, 'fix: add() adds, with a test');
  const command =
    'node -e "if (process.env.MY_SECRET) { console.error(\'secret leaked\'); process.exit(1); }" && node --test {files}';
  harnessConfig(dir, { command });

  const dirty = verify(dir, [], { MY_SECRET: 'leak' });
  assert.notEqual(dirty.code, 0, dirty.output);
  assert.match(dirty.evidence.redAtBase.reason, /fails on the fix too|cannot run in a clean tree/i);

  const clean = verify(dir, ['--clean-env'], { MY_SECRET: 'leak' });
  assert.equal(clean.code, 0, clean.output);
  assert.equal(clean.evidence.redAtBase.ok, true);
});

test('a fixture added in the diff is refused, not counted as a red', (t) => {
  const dir = project(t, 'red-fixture');
  fs.writeFileSync(path.join(dir, 'math.js'), 'function add(a, b) {\n  return a + b;\n}\n\nmodule.exports = { add };\n');
  commit(dir, 'base: add() is correct');
  git(dir, ['checkout', '-q', '-b', 'fix']);
  writeTest(dir, [
    "const test = require('node:test');",
    "const assert = require('node:assert');",
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    "const expected = fs.readFileSync(path.join(__dirname, '..', 'testdata', 'expected.txt'), 'utf8').trim();",
    '',
    "test('reads a fixture added in this diff', () => {",
    "  assert.equal(expected, '5');",
    '});',
    '',
  ].join('\n'));
  fs.mkdirSync(path.join(dir, 'testdata'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'testdata', 'expected.txt'), '5\n');
  commit(dir, 'test: read a fixture added here');
  harnessConfig(dir, { command: 'node --test --test-reporter=tap {files}' });

  const { code, output, evidence } = verify(dir);

  assert.notEqual(code, 0, output);
  assert.equal(evidence.redAtBase.ok, false);
  assert.equal(evidence.redAtBase.baseExit, null);
  assert.match(evidence.redAtBase.reason, /non-test files/i);
  assert.match(evidence.redAtBase.reason, /testdata\/expected\.txt/);
  assert.equal(worktreeCount(dir), 1);
});

test('a fixture under test/fixtures is refused, not counted as a red', (t) => {
  const dir = buggyBase(t);
  writeTest(dir, [
    "const test = require('node:test');",
    "const assert = require('node:assert');",
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    "const { add } = require('../math');",
    "const expected = Number(fs.readFileSync(path.join(__dirname, 'fixtures', 'expected.txt'), 'utf8').trim());",
    '',
    "test('adds two numbers', () => {",
    '  assert.equal(add(2, 3), expected);',
    '});',
    '',
  ].join('\n'));
  fs.mkdirSync(path.join(dir, 'test', 'fixtures'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'test', 'fixtures', 'expected.txt'), '5\n');
  fixed(dir);
  commit(dir, 'fix: add() adds, with a test and a fixture');
  harnessConfig(dir, { command: 'node --test --test-reporter=tap {files}' });

  const { code, output, evidence } = verify(dir);

  assert.notEqual(code, 0, output);
  assert.equal(evidence.redAtBase.ok, false);
  assert.equal(evidence.redAtBase.baseExit, null);
  assert.match(evidence.redAtBase.reason, /non-test files/i);
  assert.match(evidence.redAtBase.reason, /test\/fixtures\/expected\.txt/);
  assert.equal(worktreeCount(dir), 1);
});

test('a data file with a code extension is refused too', (t) => {
  const dir = buggyBase(t);
  writeTest(dir, [
    "const test = require('node:test');",
    "const assert = require('node:assert');",
    "const { add } = require('../math');",
    "const expected = require('../data/expected');",
    '',
    "test('adds two numbers', () => {",
    '  assert.equal(add(2, 3), expected);',
    '});',
    '',
  ].join('\n'));
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'data', 'expected.js'), 'module.exports = 5;\n');
  fixed(dir);
  commit(dir, 'fix: add() adds, with a data module');
  harnessConfig(dir, { command: 'node --test --test-reporter=tap {files}' });

  const { code, output, evidence } = verify(dir);

  assert.notEqual(code, 0, output);
  assert.equal(evidence.redAtBase.ok, false);
  assert.equal(evidence.redAtBase.baseExit, null);
  assert.match(evidence.redAtBase.reason, /non-test files/i);
  assert.match(evidence.redAtBase.reason, /data\/expected\.js/);
  assert.equal(worktreeCount(dir), 1);
});

test('a package.json change is refused as non-code', (t) => {
  const dir = buggyBase(t);
  writeTest(dir, [
    "const test = require('node:test');",
    "const assert = require('node:assert');",
    "const { name } = require('../package.json');",
    "const { add } = require('../math');",
    '',
    "test('uses the package name from this branch', () => {",
    "  assert.equal(name, 'red-at-base-head');",
    '  assert.equal(add(2, 3), 5);',
    '});',
    '',
  ].join('\n'));
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'red-at-base-head', scripts: { test: 'node --test' } }, null, 2),
  );
  fixed(dir);
  commit(dir, 'fix: add() adds, package renamed');
  harnessConfig(dir, { command: 'node --test --test-reporter=tap {files}' });

  const { code, output, evidence } = verify(dir);

  assert.notEqual(code, 0, output);
  assert.equal(evidence.redAtBase.ok, false);
  assert.equal(evidence.redAtBase.baseExit, null);
  assert.match(evidence.redAtBase.reason, /not plain JavaScript\/TypeScript code: package\.json/);
  assert.match(evidence.redAtBase.reason, /package\.json/);
  assert.equal(worktreeCount(dir), 1);
});

test('an added migration is refused, not exempted by the coverage non-behavior list', (t) => {
  const dir = buggyBase(t);
  writeTest(dir, [
    "const test = require('node:test');",
    "const assert = require('node:assert');",
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    "const { add } = require('../math');",
    "const migration = fs.readFileSync(path.join(__dirname, '..', 'migrations', '001.sql'), 'utf8');",
    '',
    "test('adds two numbers', () => {",
    "  assert.equal(add(2, 3), 5);",
    "  assert.match(migration, /create table/i);",
    '});',
    '',
  ].join('\n'));
  fs.mkdirSync(path.join(dir, 'migrations'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'migrations', '001.sql'), 'create table t (id integer);\n');
  fixed(dir);
  commit(dir, 'fix: add() adds, with a migration');
  harnessConfig(dir, { command: 'node --test --test-reporter=tap {files}' });

  const { code, output, evidence } = verify(dir);

  assert.notEqual(code, 0, output);
  assert.equal(evidence.redAtBase.ok, false);
  assert.equal(evidence.redAtBase.baseExit, null);
  assert.match(evidence.redAtBase.reason, /migrations\/001\.sql/);
  assert.equal(worktreeCount(dir), 1);
});

test('a modified test-runner config is refused, not exempted', (t) => {
  const dir = buggyBase(t);
  fs.writeFileSync(path.join(dir, 'vitest.config.js'), 'module.exports = {};\n');
  commit(dir, 'base: test-runner config');
  writeTest(dir, ADDING_TEST);
  fs.writeFileSync(path.join(dir, 'vitest.config.js'), 'module.exports = { test: { globals: true } };\n');
  fixed(dir);
  commit(dir, 'fix: add() adds, config updated');
  harnessConfig(dir, { command: 'node --test --test-reporter=tap {files}' });

  const { code, output, evidence } = verify(dir);

  assert.notEqual(code, 0, output);
  assert.equal(evidence.redAtBase.ok, false);
  assert.equal(evidence.redAtBase.baseExit, null);
  assert.match(evidence.redAtBase.reason, /vitest\.config\.js/);
  assert.equal(worktreeCount(dir), 1);
});

test('a deleted file is refused, not left in the base tree', (t) => {
  const dir = project(t, 'red-deleted');
  fs.writeFileSync(path.join(dir, 'math.js'), 'function add(a, b) {\n  return a - b;\n}\n\nmodule.exports = { add };\n');
  fs.writeFileSync(path.join(dir, 'old-config.js'), 'module.exports = {};\n');
  commit(dir, 'base: add() subtracts, old config present');
  git(dir, ['checkout', '-q', '-b', 'fix']);
  writeTest(dir, ADDING_TEST);
  fixed(dir);
  git(dir, ['rm', '-q', 'old-config.js']);
  commit(dir, 'fix: add() adds, remove old config');
  harnessConfig(dir, { command: 'node --test --test-reporter=tap {files}' });

  const { code, output, evidence } = verify(dir);

  assert.notEqual(code, 0, output);
  assert.equal(evidence.redAtBase.ok, false);
  assert.equal(evidence.redAtBase.baseExit, null);
  assert.match(evidence.redAtBase.reason, /old-config\.js/);
  assert.equal(worktreeCount(dir), 1);
});

test('an uncommitted source change is refused before the trees are built', (t) => {
  const dir = buggyBase(t);
  writeTest(dir, ADDING_TEST);
  fixed(dir);
  commit(dir, 'fix: add() adds, with a test');
  harnessConfig(dir, { command: 'node --test --test-reporter=tap {files}' });
  fs.writeFileSync(path.join(dir, 'math.js'), 'function add(a, b) {\n  return 0;\n}\n\nmodule.exports = { add };\n');

  const { code, output, evidence } = verify(dir);

  assert.notEqual(code, 0, output);
  assert.equal(evidence.redAtBase.ok, false);
  assert.equal(evidence.redAtBase.baseExit, null);
  assert.match(evidence.redAtBase.reason, /uncommitted non-test changes/i);
  assert.match(evidence.redAtBase.reason, /math\.js/);
  assert.equal(worktreeCount(dir), 1);
});

test('an extensionless script (a shebang) is code, not copied into the base tree', (t) => {
  const dir = project(t, 'red-extensionless');
  fs.mkdirSync(path.join(dir, 'bin'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'bin', 'tool'),
    "#!/usr/bin/env node\nfunction add(a, b) {\n  return a - b;\n}\n\nmodule.exports = { add };\n",
  );
  commit(dir, 'base: the extensionless tool subtracts');
  git(dir, ['checkout', '-q', '-b', 'fix']);
  writeTest(dir, [
    "const test = require('node:test');",
    "const assert = require('node:assert');",
    "const { add } = require('../bin/tool');",
    '',
    "test('adds two numbers', () => {",
    '  assert.equal(add(2, 3), 5);',
    '});',
    '',
  ].join('\n'));
  fs.writeFileSync(
    path.join(dir, 'bin', 'tool'),
    "#!/usr/bin/env node\nfunction add(a, b) {\n  return a + b;\n}\n\nmodule.exports = { add };\n",
  );
  commit(dir, 'fix: the extensionless tool adds');
  harnessConfig(dir, { command: 'node --test --test-reporter=tap {files}' });

  const { code, output, evidence } = verify(dir);

  assert.equal(code, 0, output);
  assert.equal(evidence.redAtBase.ok, true);
  assert.equal(worktreeCount(dir), 1);
});

test('a test file under a fixture directory is still discovered', (t) => {
  const dir = buggyBase(t);
  writeTest(
    dir,
    [
      "const test = require('node:test');",
      "const assert = require('node:assert');",
      "const { add } = require('../../math');",
      '',
      "test('adds two numbers', () => {",
      '  assert.equal(add(2, 3), 5);',
      '});',
      '',
    ].join('\n'),
    path.join('test', 'fixtures', 'only.test.js'),
  );
  fixed(dir);
  commit(dir, 'fix: add() adds, with a test under fixtures');
  harnessConfig(dir, { command: 'node --test --test-reporter=tap {files}' });

  const { code, output, evidence } = verify(dir);

  assert.equal(code, 0, output);
  assert.equal(evidence.redAtBase.ok, true);
  assert.deepStrictEqual(evidence.redAtBase.files, ['test/fixtures/only.test.js']);
  assert.equal(worktreeCount(dir), 1);
});

test('a fix that handles a missing file is still a valid red', (t) => {
  const dir = project(t, 'red-missing-file');
  fs.writeFileSync(
    path.join(dir, 'config.js'),
    "function readConfig() {\n  throw Object.assign(new Error(\"ENOENT: no such file or directory, open 'config.txt'\"), { code: 'ENOENT' });\n}\n\nmodule.exports = { readConfig };\n",
  );
  commit(dir, 'base: readConfig throws when the file is absent');
  git(dir, ['checkout', '-q', '-b', 'fix']);
  writeTest(dir, [
    "const test = require('node:test');",
    "const assert = require('node:assert');",
    "const { readConfig } = require('../config');",
    '',
    "test('falls back when config is absent', () => {",
    "  assert.equal(readConfig(), 'default');",
    '});',
    '',
  ].join('\n'));
  fs.writeFileSync(
    path.join(dir, 'config.js'),
    "function readConfig() {\n  return 'default';\n}\n\nmodule.exports = { readConfig };\n",
  );
  commit(dir, 'fix: readConfig falls back when the file is absent');
  harnessConfig(dir, { command: 'node --test --test-reporter=tap {files}' });

  const { code, output, evidence } = verify(dir);

  assert.equal(code, 0, output);
  assert.equal(evidence.redAtBase.ok, true);
  assert.match(evidence.redAtBase.reason, /failed at the merge base and passed at HEAD/i);
  assert.equal(worktreeCount(dir), 1);
});

test('a modified test file is run through both sides', (t) => {
  const dir = project(t, 'red-modified');
  fs.writeFileSync(path.join(dir, 'math.js'), 'function add(a, b) {\n  return a - b;\n}\n\nmodule.exports = { add };\n');
  writeTest(dir, "test('noop', () => {});\n");
  commit(dir, 'base: add() subtracts, with a weak test');
  git(dir, ['checkout', '-q', '-b', 'fix']);
  writeTest(dir, ADDING_TEST);
  fixed(dir);
  commit(dir, 'fix: add() adds, test now catches the subtraction');
  harnessConfig(dir, { command: 'node --test --test-reporter=tap {files}' });

  const { code, output, evidence } = verify(dir);

  assert.equal(code, 0, output);
  assert.equal(evidence.redAtBase.ok, true);
  assert.deepStrictEqual(evidence.redAtBase.files, ['test/math.test.js']);
  assert.equal(worktreeCount(dir), 1);
});

test('a diff that breaks its own test names the HEAD failure', (t) => {
  const dir = project(t, 'red-head-fails');
  fs.writeFileSync(path.join(dir, 'math.js'), 'function add(a, b) {\n  return a + b;\n}\n\nmodule.exports = { add };\n');
  commit(dir, 'base: add() is correct');
  git(dir, ['checkout', '-q', '-b', 'fix']);
  writeTest(dir, ADDING_TEST);
  fs.writeFileSync(path.join(dir, 'math.js'), 'function add(a, b) {\n  return a - b;\n}\n\nmodule.exports = { add };\n');
  commit(dir, 'fix: add a test and break add()');
  harnessConfig(dir, { command: 'node --test --test-reporter=tap {files}' });

  const { code, output, evidence } = verify(dir);

  assert.notEqual(code, 0, output);
  assert.equal(evidence.redAtBase.ok, false);
  assert.equal(evidence.redAtBase.baseExit, 0);
  assert.notEqual(evidence.redAtBase.headExit, 0);
  assert.match(evidence.redAtBase.reason, /passes at the merge base but fails on the fix/i);
  assert.match(evidence.redAtBase.reason, /--- HEAD ---/);
  assert.equal(worktreeCount(dir), 1);
});

test('an unobservable command is reported, not treated as a red', (t) => {
  const dir = buggyBase(t);
  writeTest(dir, ADDING_TEST);
  fixed(dir);
  commit(dir, 'fix: add() adds, with a test');

  const { readHarnessConfig } = require('../bin/lib/harness-config');
  const { runRedAtBase } = require('../bin/lib/red-at-base');
  const config = { ...readHarnessConfig(dir).config, redAtBase: { command: 'node --test --test-reporter=tap {files}' } };

  const result = runRedAtBase({
    root: dir,
    config,
    runCommand: () => ({
      toolError: 'spawn failed',
      exitCode: null,
      durationMs: 1,
      stdoutTail: '',
      stderrTail: '',
      failureLines: [],
    }),
  });

  assert.equal(result.ok, false);
  assert.match(result.reason, /could not be observed/i);
  assert.equal(worktreeCount(dir), 1);
});

// Real `node --test` runs: piped, it prints TAP, whose `stack:` frames have no
// `at ` and sit well below the error line.
function libFix(t, prefix, baseLib, fixedLib, testBody) {
  const dir = project(t, prefix);
  fs.writeFileSync(path.join(dir, 'lib.js'), baseLib);
  commit(dir, 'base');
  git(dir, ['checkout', '-q', '-b', 'fix']);
  fs.writeFileSync(path.join(dir, 'lib.js'), fixedLib);
  writeTest(dir, testBody, path.join('test', 'lib.test.js'));
  commit(dir, 'fix');
  harnessConfig(dir, { command: 'node --test --test-reporter=tap {files}' });
  return dir;
}

for (const [name, baseLib, fixedLib, body] of [
  [
    'a loader requiring a misnamed module',
    "module.exports = require('pathx');\n",
    "module.exports = require('path');\n",
    "assert.equal(typeof require('../lib').join, 'function');",
  ],
  [
    'a parser throwing a SyntaxError',
    'exports.parse = (s) => JSON.parse(s);\n',
    'exports.parse = (s) => { try { return JSON.parse(s); } catch { return null; } };\n',
    "assert.equal(require('../lib').parse('{a:1}'), null);",
  ],
  [
    'a test expecting a SyntaxError the fix now throws',
    'exports.parse = (s) => { try { return JSON.parse(s); } catch { return null; } };\n',
    'exports.parse = (s) => JSON.parse(s);\n',
    "assert.throws(() => require('../lib').parse('{a:1}'), SyntaxError);",
  ],
]) {
  test(`${name} in changed code is a valid red (real run)`, (t) => {
    const dir = libFix(t, 'red-real', baseLib, fixedLib, [
      "const test = require('node:test');",
      "const assert = require('node:assert');",
      '',
      "test('behaves', () => {",
      `  ${body}`,
      '});',
      '',
    ].join('\n'));

    const { code, output, evidence } = verify(dir);

    assert.equal(code, 0, output);
    assert.equal(evidence.redAtBase.ok, true, evidence.redAtBase.reason);
    assert.notEqual(evidence.redAtBase.baseExit, 0);
    assert.equal(worktreeCount(dir), 1);
  });
}

// Base outputs captured from node's runner (trimmed), one that reached a test
// and failed in it, one that never reached its tests.
const BASE_OUTPUTS = {
  tapRan: [
    'TAP version 13',
    '# Subtest: adds',
    'not ok 1 - adds',
    '  ---',
    '  duration_ms: 3.5',
    "  type: 'test'",
    "  location: '<tree>/test/math.test.js:3:1'",
    "  failureType: 'testCodeFailure'",
    "  error: '-1 == 5'",
    "  code: 'ERR_ASSERTION'",
    '  ...',
    '1..1',
    '# fail 1',
  ].join('\n'),
  tapNeverStarted: [
    'TAP version 13',
    "# SyntaxError: The requested module './lib.mjs' does not provide an export named 'sub'",
    '# Subtest: test/math.test.mjs',
    'not ok 1 - test/math.test.mjs',
    '  ---',
    "  location: '/w/test/math.test.mjs:1:1'",
    "  failureType: 'testCodeFailure'",
    '  exitCode: 1',
    '  signal: ~',
    "  error: 'test failed'",
    "  code: 'ERR_TEST_FAILURE'",
    '  ...',
    '1..1',
  ].join('\n'),
};

// Captured too: runs that look red overall but where the red is not a test.
const MIXED_OUTPUTS = {
  // A failing todo test never sets the exit code; the suite hook did.
  tap: [
    'TAP version 13',
    'not ok 1 - later # TODO',
    '  ---',
    "  failureType: 'testCodeFailure'",
    "  error: 'todo fails'",
    '  ...',
    '# Subtest: s',
    '    not ok 1 - x',
    '      ---',
    "      failureType: 'cancelledByParent'",
    '      ...',
    'not ok 2 - s',
    '  ---',
    "  failureType: 'hookFailed'",
    "  error: 'ECONNREFUSED'",
    '  ...',
  ].join('\n'),
};

function runWithBase(t, base, overrides = {}) {
  const dir = buggyBase(t);
  writeTest(dir, ADDING_TEST);
  fixed(dir);
  commit(dir, 'fix: add() adds, with a test');

  const { readHarnessConfig } = require('../bin/lib/harness-config');
  const { runRedAtBase } = require('../bin/lib/red-at-base');
  const config = { ...readHarnessConfig(dir).config, redAtBase: { command: 'node --test --test-reporter=tap {files}' } };
  let calls = 0;

  const result = runRedAtBase({
    root: dir,
    config,
    runCommand: (command, options) => {
      // The classifier needs the whole output, not the 4 KB tails.
      assert.equal(options.keepOutput, true);
      calls += 1;
      if (calls === 1) {
        const output = base.split('<tree>').join(options.cwd);
        return { ok: false, exitCode: 1, timedOut: false, toolError: null, durationMs: 1, output, stdoutTail: output.slice(-4000), stderrTail: '', failureLines: [], ...overrides };
      }
      return { ok: true, exitCode: 0, timedOut: false, toolError: null, durationMs: 1, output: 'ok', stdoutTail: 'ok', stderrTail: '', failureLines: [] };
    },
  });

  assert.equal(worktreeCount(dir), 1);
  return result;
}

test('a test that ran and failed at base is a red', (t) => {
  const result = runWithBase(t, BASE_OUTPUTS.tapRan);

  assert.equal(result.ok, true, result.reason);
});

test('a file that never reached its tests is not a red', (t) => {
  const result = runWithBase(t, BASE_OUTPUTS.tapNeverStarted);

  assert.equal(result.ok, false);
  assert.match(result.reason, /cannot run in a clean tree/i);
});

for (const [runner, output] of Object.entries(MIXED_OUTPUTS)) {
  test(`${runner}: a red that is not a test that started and failed is refused`, (t) => {
    const result = runWithBase(t, output);

    assert.equal(result.ok, false);
    assert.doesNotMatch(result.reason, /failed at the merge base and passed at HEAD/);
  });
}

test('a red from a test outside the diff is not this diff\'s red', (t) => {
  const output = "TAP version 13\nnot ok 1 - old\n  ---\n  type: 'test'\n  location: '<tree>/legacy/test/math.test.js:1:1'\n  failureType: 'testCodeFailure'\n  error: 'stale'\n  ...\n1..1\n";
  const result = runWithBase(t, output);

  assert.equal(result.ok, false);
  assert.match(result.reason, /does not show a test from the diff that ran and failed/);
});

test('node 18 ESM: a file:// location from the diff is read as a red', (t) => {
  const output = "TAP version 13\nnot ok 1 - adds\n  ---\n  location: 'file://<tree>/test/math.test.js:2:1'\n  failureType: 'testCodeFailure'\n  error: '-1 == 5'\n  ...\n1..1\n";
  const result = runWithBase(t, output);

  assert.equal(result.ok, true, result.reason);
});

test('an `exitCode:` line inside an error message does not hide a real red', (t) => {
  const output = [
    'TAP version 13',
    'not ok 1 - adds',
    '  ---',
    "  type: 'test'",
    "  location: '<tree>/test/math.test.js:3:1'",
    "  failureType: 'testCodeFailure'",
    '  error: |-',
    '    child failed',
    '    exitCode: 1',
    "  code: 'ERR_TEST_FAILURE'",
    '  ...',
    '1..1',
  ].join('\n');
  const result = runWithBase(t, output);

  assert.equal(result.ok, true, result.reason);
});

test('colour codes in the base output do not hide a real red', (t) => {
  const coloured = BASE_OUTPUTS.tapRan.replace(/^(TAP version|not ok)/gm, '\u001b[31m$1\u001b[39m');
  const result = runWithBase(t, coloured);

  assert.equal(result.ok, true, result.reason);
});

test('a TAP run mixing a failed test and a file that never loaded is not a red', (t) => {
  const result = runWithBase(t, `${BASE_OUTPUTS.tapRan}\n${BASE_OUTPUTS.tapNeverStarted.replace('TAP version 13\n', '')}`);

  assert.equal(result.ok, false);
  assert.match(result.reason, /cannot run in a clean tree/i);
});

test('the never-started block above the 4 KB tail is still read', (t) => {
  const passing = Array.from({ length: 200 }, (_, i) => `# Subtest: t${i}\nok ${i + 2} - t${i}\n  ---\n  duration_ms: 1\n  ...`).join('\n');
  const result = runWithBase(t, `${BASE_OUTPUTS.tapNeverStarted}\n${passing}\n${BASE_OUTPUTS.tapRan.replace('TAP version 13\n', '')}`);

  assert.equal(result.ok, false);
  assert.match(result.reason, /cannot run in a clean tree/i);
});

// Other runners' reds, captured from Jest 29, Vitest 4 and Go 1.26: a red
// red-at-base does not read is refused, even when it names the diff's test.
for (const failure of [
  'FAIL test/math.test.js\n  ✕ adds (83 ms)\n\nTest Suites: 1 failed, 1 total\nTests:       1 failed, 1 passed, 2 total\n',
  ' FAIL  test/math.test.js > adds\nAssertionError: expected -1 to be 5\n\n Test Files  1 failed (1)\n      Tests  1 failed | 1 passed (2)\n',
  '--- FAIL: TestAdd (0.00s)\n    calc_test.go:7: got -1\nFAIL\nFAIL\texample.com/g/calc\t0.033s\nFAIL\n',
  'TAP version 13\nnot ok 1 - test/math.test.js > adds # time=1.2ms\n    ---\n    error:\n        name: \"AssertionError\"\n        message: \"expected -1 to be 5\"\n    at: \"<tree>/test/math.test.js:5:20\"\n    ...\n1..1\n',
  "test/math.test.ts(3,15): error TS2724: '\"../math\"' has no exported member named 'sub'.",
  'error[E0425]: cannot find function `sub` in module `math`',
  'MathTest.java:7: error: cannot find symbol',
  "ERROR collecting tests/test_math.py\nE   AttributeError: module 'lib' has no attribute 'STRICT'\nInterrupted: 1 error during collection",
  '✖ rejects a SyntaxError input (1.2ms)\nℹ fail 1',
]) {
  test(`output red-at-base does not read is refused, never a red: ${failure.slice(0, 32)}`, (t) => {
    const result = runWithBase(t, failure);

    assert.equal(result.ok, false);
    assert.match(result.reason, /does not show a test from the diff that ran and failed/);
    assert.match(result.reason, /--test-reporter=tap/);
  });
}

test('a base run that timed out or was killed is not a red', (t) => {
  const timedOut = runWithBase(t, BASE_OUTPUTS.tapRan, { timedOut: true, exitCode: 124 });
  assert.equal(timedOut.ok, false);
  assert.match(timedOut.reason, /did not finish at the merge base \(timed out\)/);

  const killed = runWithBase(t, BASE_OUTPUTS.tapRan, { signal: 'SIGKILL' });
  assert.equal(killed.ok, false);
  assert.match(killed.reason, /killed by SIGKILL/);

  const underShell = runWithBase(t, BASE_OUTPUTS.tapRan, { exitCode: 137 });
  assert.equal(underShell.ok, false);
  assert.match(underShell.reason, /killed by signal 9/);
});

test('a worktree locked during the run is still removed', (t) => {
  const dir = buggyBase(t);
  writeTest(dir, ADDING_TEST);
  fixed(dir);
  commit(dir, 'fix: add() adds, with a test');

  const { readHarnessConfig } = require('../bin/lib/harness-config');
  const { runRedAtBase } = require('../bin/lib/red-at-base');
  const config = { ...readHarnessConfig(dir).config, redAtBase: { command: 'node --test --test-reporter=tap {files}' } };
  let calls = 0;
  let runDir = null;

  const result = runRedAtBase({
    root: dir,
    config,
    runCommand: (command, { cwd }) => {
      calls += 1;
      if (calls === 1) {
        runDir = path.dirname(cwd);
        execFileSync('git', ['worktree', 'lock', '.'], { cwd, stdio: 'ignore' });
        const output = BASE_OUTPUTS.tapRan.split('<tree>').join(cwd);
        return { ok: false, exitCode: 1, durationMs: 1, output, stdoutTail: output, stderrTail: '', failureLines: [] };
      }
      return { ok: true, exitCode: 0, durationMs: 1, stdoutTail: 'ok 1', stderrTail: '', failureLines: [] };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(worktreeCount(dir), 1);
  assert.equal(fs.existsSync(runDir), false);
});

test('the trees live outside the git dir and outside the checkout', (t) => {
  const dir = buggyBase(t);
  writeTest(dir, ADDING_TEST);
  fixed(dir);
  commit(dir, 'fix: add() adds, with a test');

  const { readHarnessConfig } = require('../bin/lib/harness-config');
  const { runRedAtBase } = require('../bin/lib/red-at-base');
  const config = { ...readHarnessConfig(dir).config, redAtBase: { command: 'node --test --test-reporter=tap {files}' } };
  const seen = [];

  runRedAtBase({
    root: dir,
    config,
    runCommand: (command, { cwd }) => {
      seen.push(cwd);
      return { ok: true, exitCode: 0, durationMs: 1, stdoutTail: 'ok 1', stderrTail: '', failureLines: [] };
    },
  });

  assert.equal(seen.length, 2);
  for (const cwd of seen) {
    assert.doesNotMatch(cwd.split(path.sep).join('/'), /\/\.git\//);
    assert.equal(path.relative(dir, cwd).startsWith('..'), true, cwd);
  }
});

test('a tree left by a killed run is swept by the next one', (t) => {
  const dir = buggyBase(t);
  writeTest(dir, ADDING_TEST);
  fixed(dir);
  commit(dir, 'fix: add() adds, with a test');
  harnessConfig(dir, { command: 'node --test --test-reporter=tap {files}' });

  const { spawnSync } = require('node:child_process');
  const deadPid = spawnSync(process.execPath, ['-e', '']).pid;
  const orphan = fs.mkdtempSync(path.join(os.tmpdir(), `coding-flow-red-at-base-${deadPid}-`));
  t.after(() => fs.rmSync(orphan, { recursive: true, force: true }));
  fs.writeFileSync(path.join(orphan, '.coding-flow-red-at-base'), `${deadPid}\n`);
  git(dir, ['worktree', 'add', '-q', '--detach', path.join(orphan, 'base'), 'HEAD']);
  assert.equal(worktreeCount(dir), 2);

  const { code, output, evidence } = verify(dir);

  assert.equal(code, 0, output);
  assert.equal(evidence.redAtBase.ok, true);
  assert.equal(worktreeCount(dir), 1);
  assert.equal(fs.existsSync(orphan), false);
});

test('the sweep never removes a checkout or worktree it did not create', (t) => {
  const { spawnSync } = require('node:child_process');
  const deadPid = spawnSync(process.execPath, ['-e', '']).pid;
  const area = (suffix) => {
    const made = fs.mkdtempSync(path.join(os.tmpdir(), `coding-flow-red-at-base-${deadPid}-${suffix}`));
    t.after(() => fs.rmSync(made, { recursive: true, force: true }));
    return made;
  };

  // The main checkout itself, named like a run tree, marker and all.
  const mainArea = area('main');
  fs.writeFileSync(path.join(mainArea, '.coding-flow-red-at-base'), `${deadPid}\n`);
  const dir = path.join(mainArea, 'base');
  fs.mkdirSync(dir);
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'red-at-base@example.com']);
  git(dir, ['config', 'user.name', 'Red At Base']);
  fs.writeFileSync(path.join(dir, '.gitignore'), '.coding-flow/\n');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'x', scripts: { test: 'node --test' } }));
  fs.writeFileSync(path.join(dir, 'math.js'), 'function add(a, b) {\n  return a - b;\n}\n\nmodule.exports = { add };\n');
  commit(dir, 'base: add() subtracts');
  git(dir, ['checkout', '-q', '-b', 'fix']);
  writeTest(dir, ADDING_TEST);
  fixed(dir);
  commit(dir, 'fix: add() adds, with a test');
  harnessConfig(dir, { command: 'node --test --test-reporter=tap {files}' });
  fs.writeFileSync(path.join(mainArea, 'user-notes.txt'), 'mine\n');

  // A user's linked worktree under a prefix-named folder, without the marker.
  const userArea = area('user');
  git(dir, ['worktree', 'add', '-q', '-b', 'feature', path.join(userArea, 'head'), 'HEAD']);
  fs.writeFileSync(path.join(userArea, 'head', 'notes.txt'), 'uncommitted\n');

  const { code, output, evidence } = verify(dir);

  assert.equal(code, 0, output);
  assert.equal(evidence.redAtBase.ok, true);
  assert.equal(fs.readFileSync(path.join(mainArea, 'user-notes.txt'), 'utf8'), 'mine\n');
  assert.equal(fs.existsSync(path.join(dir, '.git')), true);
  assert.equal(fs.readFileSync(path.join(userArea, 'head', 'notes.txt'), 'utf8'), 'uncommitted\n');
  assert.equal(worktreeCount(dir), 2);
});

// Without isolation a file that fails to load prints nothing (fourteenth
// review), so the command is refused before any tree is built.
test('a command without test isolation is refused, never read', (t) => {
  const dir = project(t, 'red-iso-none');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'iso', type: 'module' }));
  fs.writeFileSync(path.join(dir, 'lib.mjs'), 'export const add = (a, b) => a - b;\n');
  commit(dir, 'base: add() subtracts, no sub()');
  git(dir, ['checkout', '-q', '-b', 'fix']);
  fs.writeFileSync(path.join(dir, 'lib.mjs'), 'export const add = (a, b) => a + b;\nexport const sub = (a, b) => a - b;\n');
  writeTest(dir, "import test from 'node:test';\nimport assert from 'node:assert';\nimport { add } from '../lib.mjs';\ntest('adds', () => assert.equal(add(2, 3), 5));\n", path.join('test', 'add.test.mjs'));
  writeTest(dir, "import test from 'node:test';\nimport assert from 'node:assert';\nimport { sub } from '../lib.mjs';\ntest('subs', () => assert.equal(sub(3, 2), 1));\n", path.join('test', 'sub.test.mjs'));
  commit(dir, 'fix: add() adds, sub() added');
  harnessConfig(dir, { command: 'node --test --test-reporter=tap --experimental-test-isolation=none {files}' });

  const { output, evidence } = verify(dir);

  assert.equal(evidence.redAtBase.ok, false, output);
  assert.equal(evidence.redAtBase.baseExit, null);
  assert.match(evidence.redAtBase.reason, /without isolation/);
  assert.equal(worktreeCount(dir), 1);
});

// By name, or because the command preloads it: either way it runs before every
// test, so a change there is not the fix.
for (const [name, command] of [
  ['jest-setup.js', 'node --test --test-reporter=tap {files}'],
  ['setup-tests.ts', 'node --test --test-reporter=tap {files}'],
  ['global-setup.ts', 'node --test --test-reporter=tap {files}'],
  ['prepare-env.js', 'node --require ./prepare-env.js --test --test-reporter=tap {files}'],
  ['register.mjs', 'node --import=./register.mjs --test --test-reporter=tap {files}'],
]) {
  test(`a modified test-setup file (${name}) is refused, not counted as the fix`, (t) => {
    const dir = buggyBase(t);
    git(dir, ['checkout', '-q', 'main']);
    fs.writeFileSync(path.join(dir, name), 'globalThis.TWO = 1;\n');
    commit(dir, `base: ${name}`);
    git(dir, ['checkout', '-q', '-B', 'fix']);
    fs.writeFileSync(path.join(dir, name), 'globalThis.TWO = 2;\n');
    writeTest(dir, ADDING_TEST);
    fixed(dir);
    commit(dir, `fix: add() adds, ${name} updated`);
    harnessConfig(dir, { command });

    const { code, output, evidence } = verify(dir);

    assert.notEqual(code, 0, output);
    assert.equal(evidence.redAtBase.baseExit, null);
    assert.match(evidence.redAtBase.reason, new RegExp(`code: ${name.replace('.', '\\.')}`));
  });
}

test('an extensionless data file is data, so a data-only diff has nothing to be red against', (t) => {
  const dir = buggyBase(t);
  git(dir, ['checkout', '-q', 'main']);
  fs.mkdirSync(path.join(dir, 'fixtures'));
  fs.writeFileSync(path.join(dir, 'fixtures', 'expected'), '4\n');
  commit(dir, 'base: expected value');
  git(dir, ['checkout', '-q', '-B', 'fix']);
  fs.writeFileSync(path.join(dir, 'fixtures', 'expected'), '5\n');
  writeTest(dir, [
    "const test = require('node:test');",
    "const assert = require('node:assert');",
    "const fs = require('node:fs');",
    '',
    "test('expected', () => {",
    "  assert.equal(fs.readFileSync('fixtures/expected', 'utf8'), '5\\n');",
    '});',
    '',
  ].join('\n'));
  commit(dir, 'data: expected value changes');
  harnessConfig(dir, { command: 'node --test --test-reporter=tap {files}' });

  const { code, output, evidence } = verify(dir);

  assert.notEqual(code, 0, output);
  assert.equal(evidence.redAtBase.baseExit, null);
  assert.match(evidence.redAtBase.reason, /fixtures\/expected/);
});

test('a diff that changes no code has nothing to be red against', (t) => {
  const dir = buggyBase(t);
  writeTest(dir, ADDING_TEST);
  commit(dir, 'test: a test that fails at base and at HEAD alike');
  harnessConfig(dir, { command: 'node --test --test-reporter=tap {files}' });

  const { code, output, evidence } = verify(dir);

  assert.notEqual(code, 0, output);
  assert.equal(evidence.redAtBase.ok, false);
  assert.equal(evidence.redAtBase.baseExit, null);
  assert.match(evidence.redAtBase.reason, /nothing to be red against/);
  assert.equal(worktreeCount(dir), 1);
});

test('prose the diff changes is taken from HEAD, so it is never the red', (t) => {
  const dir = buggyBase(t);
  fs.writeFileSync(path.join(dir, 'README.md'), 'old\n');
  git(dir, ['checkout', '-q', 'main']);
  fs.writeFileSync(path.join(dir, 'README.md'), 'old\n');
  commit(dir, 'base: readme');
  git(dir, ['checkout', '-q', '-B', 'fix']);
  fs.writeFileSync(path.join(dir, 'README.md'), 'new\n');
  writeTest(dir, [
    "const test = require('node:test');",
    "const assert = require('node:assert');",
    "const fs = require('node:fs');",
    '',
    "test('documents', () => {",
    "  assert.equal(fs.readFileSync('README.md', 'utf8'), 'new\\n');",
    '});',
    '',
  ].join('\n'));
  fixed(dir);
  commit(dir, 'fix: add() adds, readme updated');
  harnessConfig(dir, { command: 'node --test --test-reporter=tap {files}' });

  const { code, output, evidence } = verify(dir);

  assert.notEqual(code, 0, output);
  assert.equal(evidence.redAtBase.ok, false);
  assert.equal(evidence.redAtBase.baseExit, 0);
  assert.match(evidence.redAtBase.reason, /does not demonstrate/);
});

test('a user worktree whose folder is missing keeps its registration', (t) => {
  const dir = buggyBase(t);
  writeTest(dir, ADDING_TEST);
  fixed(dir);
  commit(dir, 'fix: add() adds, with a test');
  harnessConfig(dir, { command: 'node --test --test-reporter=tap {files}' });
  const away = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-red-away-'));
  t.after(() => fs.rmSync(away, { recursive: true, force: true }));
  const userTree = path.join(away, 'external-drive');
  git(dir, ['worktree', 'add', '-q', '-b', 'feature', userTree, 'HEAD']);
  fs.renameSync(userTree, path.join(away, 'unmounted'));

  const { code, output, evidence } = verify(dir);

  assert.equal(code, 0, output);
  assert.equal(evidence.redAtBase.ok, true, evidence.redAtBase.reason);
  assert.equal(worktreeCount(dir), 2);
  fs.renameSync(path.join(away, 'unmounted'), userTree);
  assert.equal(git(userTree, ['rev-parse', '--abbrev-ref', 'HEAD']), 'feature');
});

for (const fixture of [
  path.join('specs', 'fixtures', 'rows.json'),
  path.join('docs', 'rows.json'),
  path.join('docs', 'guide.md'),
  path.join('test', 'fixtures', 'README.md'),
]) {
  test(`a fixture added as ${fixture.split(path.sep).join('/')} is refused, not ignored as documentation`, (t) => {
    const dir = buggyBase(t);
    fs.mkdirSync(path.join(dir, path.dirname(fixture)), { recursive: true });
    fs.writeFileSync(path.join(dir, fixture), '[1]\n');
    writeTest(dir, [
      "const test = require('node:test');",
      "const fs = require('node:fs');",
      '',
      "test('reads rows', () => {",
      `  fs.readFileSync(${JSON.stringify(fixture.split(path.sep).join('/'))});`,
      '});',
      '',
    ].join('\n'));
    commit(dir, 'test: rows fixture, no code change');
    harnessConfig(dir, { command: 'node --test --test-reporter=tap {files}' });

    const { code, output, evidence } = verify(dir);

    assert.notEqual(code, 0, output);
    assert.equal(evidence.redAtBase.ok, false);
    assert.equal(evidence.redAtBase.baseExit, null);
    assert.match(evidence.redAtBase.reason, /non-test files/);
    assert.equal(worktreeCount(dir), 1);
  });
}

test('the sweep spares a live run and a marked folder outside the temp dir', (t) => {
  const dir = buggyBase(t);
  writeTest(dir, ADDING_TEST);
  fixed(dir);
  commit(dir, 'fix: add() adds, with a test');
  harnessConfig(dir, { command: 'node --test --test-reporter=tap {files}' });
  const { spawnSync } = require('node:child_process');
  const deadPid = spawnSync(process.execPath, ['-e', '']).pid;

  // A concurrent run from a live process (this test's own pid).
  const live = fs.mkdtempSync(path.join(os.tmpdir(), `coding-flow-red-at-base-${process.pid}-`));
  t.after(() => fs.rmSync(live, { recursive: true, force: true }));
  fs.writeFileSync(path.join(live, '.coding-flow-red-at-base'), `${process.pid}\n`);
  git(dir, ['worktree', 'add', '-q', '--detach', path.join(live, 'base'), 'HEAD']);

  // A marked, dead-pid run folder one level below the temp dir.
  const outer = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-red-nested-'));
  t.after(() => fs.rmSync(outer, { recursive: true, force: true }));
  const nested = path.join(outer, `coding-flow-red-at-base-${deadPid}-x`);
  fs.mkdirSync(nested);
  fs.writeFileSync(path.join(nested, '.coding-flow-red-at-base'), `${deadPid}\n`);
  git(dir, ['worktree', 'add', '-q', '--detach', path.join(nested, 'head'), 'HEAD']);

  const { code, output } = verify(dir);

  assert.equal(code, 0, output);
  assert.equal(worktreeCount(dir), 3);
  assert.equal(fs.existsSync(path.join(live, 'base', 'math.js')), true);
  assert.equal(fs.existsSync(path.join(nested, 'head', 'math.js')), true);
});

test('git hooks of the user do not run in the throwaway trees', { skip: process.platform === 'win32' }, (t) => {
  const dir = buggyBase(t);
  writeTest(dir, ADDING_TEST);
  fixed(dir);
  commit(dir, 'fix: add() adds, with a test');
  harnessConfig(dir, { command: 'node --test --test-reporter=tap {files}' });
  const marker = path.join(dir, '..', `${path.basename(dir)}-hook-ran`);
  t.after(() => fs.rmSync(marker, { force: true }));
  const hook = path.join(dir, '.git', 'hooks', 'post-checkout');
  fs.writeFileSync(hook, `#!/bin/sh\necho ran >> '${marker}'\n`, { mode: 0o755 });

  const { code, output } = verify(dir);

  assert.equal(code, 0, output);
  assert.equal(fs.existsSync(marker), false);
});

test('a test importing an export the fix adds is not a red (real ESM run)', (t) => {
  const dir = project(t, 'red-esm-export');
  fs.writeFileSync(path.join(dir, 'math.mjs'), 'export function add(a, b) {\n  return a - b;\n}\n');
  commit(dir, 'base: add() subtracts, no sub()');
  git(dir, ['checkout', '-q', '-b', 'fix']);
  fs.writeFileSync(
    path.join(dir, 'math.mjs'),
    'export function add(a, b) {\n  return a + b;\n}\n\nexport function sub(a, b) {\n  return a - b;\n}\n',
  );
  writeTest(dir, [
    "import test from 'node:test';",
    "import assert from 'node:assert';",
    "import { add, sub } from '../math.mjs';",
    '',
    "test('adds and subtracts', () => {",
    '  assert.equal(add(2, 3), 5);',
    '  assert.equal(sub(3, 2), 1);',
    '});',
    '',
  ].join('\n'), path.join('test', 'math.test.mjs'));
  commit(dir, 'fix: add() adds, sub() added');
  harnessConfig(dir, { command: 'node --test --test-reporter=tap {files}' });

  const { code, output, evidence } = verify(dir);

  assert.notEqual(code, 0, output);
  assert.equal(evidence.redAtBase.ok, false);
  assert.notEqual(evidence.redAtBase.baseExit, 0);
  assert.equal(evidence.redAtBase.headExit, 0);
  assert.match(evidence.redAtBase.reason, /cannot run in a clean tree/i);
  assert.equal(worktreeCount(dir), 1);
});

for (const [file, before, after] of [
  ['.babelrc', '{}\n', '{ "presets": [] }\n'],
  ['jest.setup.js', 'globalThis.ready = false;\n', 'globalThis.ready = true;\n'],
]) {
  test(`a modified ${file} changes how the test runs and is refused, not treated as code`, (t) => {
    const dir = buggyBase(t);
    git(dir, ['checkout', '-q', 'main']);
    fs.writeFileSync(path.join(dir, file), before);
    commit(dir, `base: ${file}`);
    git(dir, ['checkout', '-q', '-B', 'fix']);
    writeTest(dir, ADDING_TEST);
    fs.writeFileSync(path.join(dir, file), after);
    fixed(dir);
    commit(dir, `fix: add() adds, ${file} updated`);
    harnessConfig(dir, { command: 'node --test --test-reporter=tap {files}' });

    const { code, output, evidence } = verify(dir);

    assert.notEqual(code, 0, output);
    assert.equal(evidence.redAtBase.ok, false);
    assert.equal(evidence.redAtBase.baseExit, null);
    assert.match(evidence.redAtBase.reason, new RegExp(`code: ${file.replace('.', '\\.')}`));
    assert.equal(worktreeCount(dir), 1);
  });
}

test('the command runner hands red-at-base the whole output and the signal', { skip: process.platform === 'win32' }, () => {
  const { runValidationCommand } = require('../bin/lib/validation-run');
  const loud = `node -e "for (let i = 0; i < 2000; i++) console.log('line ' + i); console.error('first never-started marker')"`;

  const kept = runValidationCommand(loud, { keepOutput: true });
  assert.match(kept.output, /line 0\n/);
  assert.match(kept.output, /first never-started marker/);
  assert.doesNotMatch(kept.stdoutTail, /line 0\n/);
  assert.equal('output' in runValidationCommand(loud), false);

  // The shell itself killed: the signal is reported as such.
  assert.equal(runValidationCommand('kill -TERM $$', { keepOutput: true }).signal, 'SIGTERM');
  // The runner killed under the shell: only its 128+n exit code survives.
  assert.equal(runValidationCommand(`node -e "process.kill(process.pid, 'SIGTERM')"`).exitCode, 143);
});

test('{files} is substituted with the quoted test paths', () => {
  const { expandCommand } = require('../bin/lib/red-at-base');

  assert.equal(expandCommand('node --test {files}', ['-danger.test.js']), 'node --test ./-danger.test.js');
  assert.equal(expandCommand('node --test {files}', ['test/a b.test.js']), "node --test 'test/a b.test.js'");
  assert.equal(expandCommand('node --test {files} {packages}', ['x.test.js']), 'node --test x.test.js {packages}');
});

test('bootstrap --scan suggests a red-at-base command for a node project only', (t) => {
  const vitest = project(t, 'red-scan-vitest');
  fs.writeFileSync(
    path.join(vitest, 'package.json'),
    JSON.stringify({ scripts: { test: 'vitest' }, devDependencies: { vitest: '2.0.0' } }),
  );
  const vitestScan = JSON.parse(run(vitest, ['bootstrap', '--scan', '--json']).output);
  // Only node's runner is read: a Vitest suite would always be refused.
  assert.equal(vitestScan.redAtBaseSuggestion ?? null, null);

  const python = repo(t, 'red-scan-python');
  fs.writeFileSync(path.join(python, 'pyproject.toml'), '[project]\nname = "demo"\n');
  fs.mkdirSync(path.join(python, 'tests'));
  const pythonScan = JSON.parse(run(python, ['bootstrap', '--scan', '--json']).output);
  // pytest's output is not read by red-at-base yet: a suggestion would always be refused.
  assert.equal(pythonScan.redAtBaseSuggestion ?? null, null);

  const node = project(t, 'red-scan-node');
  const nodeScan = JSON.parse(run(node, ['bootstrap', '--scan', '--json']).output);
  assert.equal(nodeScan.redAtBaseSuggestion, 'node --test --test-reporter=tap {files}');
});

// Tenth review: the classification reads git's modes and blobs, never the
// checkout, and anything that is not plain JS/TS code is refused.
function fixWithExtra(t, prefix, before, after) {
  const dir = buggyBase(t);
  git(dir, ['checkout', '-q', 'main']);
  before(dir);
  commit(dir, 'base: extra');
  git(dir, ['checkout', '-q', '-B', 'fix']);
  after(dir);
  writeTest(dir, ADDING_TEST);
  fixed(dir);
  commit(dir, 'fix: add() adds, extra changed');
  harnessConfig(dir, { command: 'node --test --test-reporter=tap {files}' });
  return dir;
}

test('a retargeted symlink is refused, even one pointing at a directory', { skip: process.platform === 'win32' }, (t) => {
  const dir = fixWithExtra(
    t,
    'red-symlink',
    (d) => {
      fs.mkdirSync(path.join(d, 'v1'));
      fs.mkdirSync(path.join(d, 'v2'));
      fs.writeFileSync(path.join(d, 'v1', 'x.js'), 'module.exports = 1;\n');
      fs.writeFileSync(path.join(d, 'v2', 'x.js'), 'module.exports = 2;\n');
      fs.symlinkSync('v1', path.join(d, 'current.js'));
    },
    (d) => {
      fs.unlinkSync(path.join(d, 'current.js'));
      fs.symlinkSync('v2', path.join(d, 'current.js'));
    },
  );

  const { code, output, evidence } = verify(dir);

  assert.notEqual(code, 0, output);
  assert.equal(evidence.redAtBase.baseExit, null);
  assert.match(evidence.redAtBase.reason, /code: current\.js/);
});

test('an executable bit does not make an extensionless data file code', { skip: process.platform === 'win32' }, (t) => {
  const dir = fixWithExtra(
    t,
    'red-execbit',
    (d) => {
      fs.writeFileSync(path.join(d, 'expected'), '4\n');
      fs.chmodSync(path.join(d, 'expected'), 0o755);
    },
    (d) => fs.writeFileSync(path.join(d, 'expected'), '5\n'),
  );

  const { code, output, evidence } = verify(dir);

  assert.notEqual(code, 0, output);
  assert.equal(evidence.redAtBase.baseExit, null);
  assert.match(evidence.redAtBase.reason, /code: expected/);
});

test('a modified file in another language is refused, not read as the fix', (t) => {
  const dir = fixWithExtra(
    t,
    'red-python',
    (d) => fs.writeFileSync(path.join(d, 'helper.py'), 'TWO = 1\n'),
    (d) => fs.writeFileSync(path.join(d, 'helper.py'), 'TWO = 2\n'),
  );

  const { code, output, evidence } = verify(dir);

  assert.notEqual(code, 0, output);
  assert.match(evidence.redAtBase.reason, /code: helper\.py/);
});

test('a test whose path holds a space is still a red (real run)', (t) => {
  const dir = buggyBase(t);
  writeTest(dir, ADDING_TEST, path.join('test', 'math adds.test.js'));
  fixed(dir);
  commit(dir, 'fix: add() adds, with a spaced test');
  harnessConfig(dir, { command: 'node --test --test-reporter=tap {files}' });

  const { code, output, evidence } = verify(dir);

  assert.equal(code, 0, output);
  assert.equal(evidence.redAtBase.ok, true, evidence.redAtBase.reason);
  assert.deepEqual(evidence.redAtBase.files, ['test/math adds.test.js']);
});

// The policy fingerprint hashes the whole harness config, redAtBase included.
test('a proof is not reused once the red-at-base command changed', (t) => {
  const dir = buggyBase(t);
  writeTest(dir, ADDING_TEST);
  fixed(dir);
  commit(dir, 'fix: add() adds, with a test');
  harnessConfig(dir, { command: 'node --test --test-reporter=tap {files}' });

  const first = verify(dir);
  assert.equal(first.evidence.redAtBase.ok, true, first.evidence.redAtBase.reason);

  harnessConfig(dir, { command: 'node --test --test-reporter=spec {files}' });
  const second = verify(dir);

  assert.equal(second.evidence.reused, undefined);
  assert.equal(second.evidence.redAtBase.ok, false);
});

// Eleventh review: a rename is a deletion of its old path, wherever it lands.
for (const [from, to] of [
  ['docs/roadmap.md', 'epics/roadmap.md'],
  ['src/fake-clock.js', 'test/support/fake-clock.js'],
]) {
  test(`a file moved from ${from} to ${to} is refused, not hidden by the rename`, (t) => {
    const dir = fixWithExtra(
      t,
      'red-rename',
      (d) => {
        fs.mkdirSync(path.dirname(path.join(d, from)), { recursive: true });
        fs.writeFileSync(path.join(d, from), 'module.exports = "kept";\n');
      },
      (d) => {
        fs.mkdirSync(path.dirname(path.join(d, to)), { recursive: true });
        git(d, ['mv', from, to]);
      },
    );

    const { code, output, evidence } = verify(dir);

    assert.notEqual(code, 0, output);
    assert.equal(evidence.redAtBase.baseExit, null);
    assert.match(evidence.redAtBase.reason, new RegExp(from.replace('.', '\\.')));
  });
}

test('an index git hands a hook is never written by the throwaway trees', (t) => {
  const dir = buggyBase(t);
  writeTest(dir, ADDING_TEST);
  fixed(dir);
  commit(dir, 'fix: add() adds, with a test');
  harnessConfig(dir, { command: 'node --test --test-reporter=tap {files}' });
  // What `git commit <path>` sets for a pre-commit hook: an absolute temp index
  // holding the change being committed (here, prose red-at-base lets through).
  const hookIndex = path.join(dir, '.git', 'next-index-test.lock');
  fs.copyFileSync(path.join(dir, '.git', 'index'), hookIndex);
  fs.writeFileSync(path.join(dir, 'README.md'), '# being committed\n');
  execFileSync('git', ['add', 'README.md'], { cwd: dir, env: { ...process.env, GIT_INDEX_FILE: hookIndex } });
  // The content, not the bytes: `git status` may refresh the stat cache.
  const staged = () => execFileSync('git', ['ls-files', '--stage'], { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_INDEX_FILE: hookIndex } });
  const before = staged();

  const { code, output, evidence } = verify(dir, ['--no-cache'], { GIT_INDEX_FILE: hookIndex });

  assert.equal(code, 0, output);
  assert.equal(evidence.redAtBase.ok, true, evidence.redAtBase.reason);
  assert.equal(staged(), before);
  assert.match(before, /README\.md/);
  assert.equal(worktreeCount(dir), 1);
});

// Twelfth review: a file named where the run is launched is setup, however
// the command names it.
for (const command of [
  "NODE_OPTIONS='--require ./scripts/setup.js' node --test --test-reporter=tap {files}",
  'node "--require=./scripts/setup.js" --test --test-reporter=tap {files}',
  'node --require=$PWD/scripts/setup --test --test-reporter=tap {files}',
  'node scripts/setup.js {files}',
]) {
  test(`a modified file the command names is setup, not the fix: ${command.slice(0, 40)}`, (t) => {
    const dir = fixWithExtra(
      t,
      'red-launch',
      (d) => {
        fs.mkdirSync(path.join(d, 'scripts'));
        fs.writeFileSync(path.join(d, 'scripts', 'setup.js'), '// setup\n');
      },
      (d) => fs.writeFileSync(path.join(d, 'scripts', 'setup.js'), 'globalThis.answer = 42;\n'),
    );
    harnessConfig(dir, { command });

    const { code, output, evidence } = verify(dir);

    assert.notEqual(code, 0, output);
    assert.equal(evidence.redAtBase.baseExit, null);
    assert.match(evidence.redAtBase.reason, /code: scripts\/setup\.js/);
  });
}

test('a modified file a package.json script runs is setup, not the fix', (t) => {
  const dir = fixWithExtra(
    t,
    'red-launch-npm',
    (d) => {
      fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ scripts: { test: 'node --require ./prep.js --test' } }));
      fs.writeFileSync(path.join(d, 'prep.js'), '// prep\n');
    },
    (d) => fs.writeFileSync(path.join(d, 'prep.js'), 'globalThis.answer = 42;\n'),
  );
  harnessConfig(dir, { command: 'npm test -- --test-reporter=tap {files}' });

  const { code, output, evidence } = verify(dir);

  assert.notEqual(code, 0, output);
  assert.match(evidence.redAtBase.reason, /code: prep\.js/);
});

test('a failure in a test the diff\'s test requires is not the diff\'s red', (t) => {
  const output = "TAP version 13\nnot ok 1 - adds\n  ---\n  type: 'test'\n  location: '<tree>/math.test.js:3:1'\n  failureType: 'testCodeFailure'\n  error: '-1 == 5'\n  ...\n1..1\n";
  // The diff's test is test/math.test.js; the red is in math.test.js at the root.
  const result = runWithBase(t, output);

  assert.equal(result.ok, false);
  assert.match(result.reason, /does not show a test from the diff that ran and failed/);
});

test('a test whose name holds an escaped # todo is still read', (t) => {
  const output = "TAP version 13\nnot ok 1 - strips \\# todo comments\n  ---\n  type: 'test'\n  location: '<tree>/test/math.test.js:3:1'\n  failureType: 'testCodeFailure'\n  error: 'kept'\n  ...\n1..1\n";
  const result = runWithBase(t, output);

  assert.equal(result.ok, true, result.reason);
});

// Thirteenth review: prose the trees do not copy, and an `.npmrc` preload.
test('prose whose type changed (a symlink become a file) is refused, not left at base', { skip: process.platform === 'win32' }, (t) => {
  const dir = fixWithExtra(
    t,
    'red-prose-type',
    (d) => {
      fs.mkdirSync(path.join(d, 'docs'));
      fs.writeFileSync(path.join(d, 'docs', 'old.md'), 'old docs\n');
      fs.symlinkSync(path.join('docs', 'old.md'), path.join(d, 'README.md'));
    },
    (d) => {
      fs.unlinkSync(path.join(d, 'README.md'));
      fs.writeFileSync(path.join(d, 'README.md'), 'new docs\n');
    },
  );

  const { code, output, evidence } = verify(dir);

  assert.notEqual(code, 0, output);
  assert.equal(evidence.redAtBase.baseExit, null);
  assert.match(evidence.redAtBase.reason, /code: README\.md/);
});

test('a modified file an .npmrc node-options preloads is setup, not the fix', (t) => {
  const dir = fixWithExtra(
    t,
    'red-npmrc',
    (d) => {
      fs.writeFileSync(path.join(d, '.npmrc'), 'node-options=--require ./setup/preload.js\n');
      fs.mkdirSync(path.join(d, 'setup'));
      fs.writeFileSync(path.join(d, 'setup', 'preload.js'), 'globalThis.FLAG = 0;\n');
    },
    (d) => fs.writeFileSync(path.join(d, 'setup', 'preload.js'), 'globalThis.FLAG = 1;\n'),
  );
  harnessConfig(dir, { command: 'npm test --silent -- --test-reporter=tap {files}' });

  const { code, output, evidence } = verify(dir);

  assert.notEqual(code, 0, output);
  assert.match(evidence.redAtBase.reason, /code: setup\/preload\.js/);
});

// Fourteenth review: the base tree's git state matches HEAD's, so a test that
// checks the tree is clean is not red at base for the copies alone.
test('a test asserting a clean git tree is not red at base for the copied test (real run)', (t) => {
  const dir = buggyBase(t);
  const hygiene = [
    "const test = require('node:test');",
    "const assert = require('node:assert');",
    "const { execFileSync } = require('node:child_process');",
    '',
    "test('the tree is clean', () => {",
    "  assert.equal(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }), '');",
    '});',
    '',
  ].join('\n');
  git(dir, ['checkout', '-q', 'main']);
  writeTest(dir, hygiene, path.join('test', 'hygiene.test.js'));
  commit(dir, 'base: a hygiene test');
  git(dir, ['checkout', '-q', '-B', 'fix']);
  writeTest(dir, `${hygiene}// generated files are committed\n`, path.join('test', 'hygiene.test.js'));
  fs.writeFileSync(path.join(dir, 'math.js'), 'function add(a, b) {\n  return a - b; // unchanged behavior\n}\n\nmodule.exports = { add };\n');
  commit(dir, 'chore: a comment in the hygiene test and in math.js');
  harnessConfig(dir, { command: 'node --test --test-reporter=tap {files}' });
  const status = git(dir, ['status', '--porcelain']);

  const { output, evidence } = verify(dir);

  assert.equal(evidence.redAtBase.ok, false, output);
  assert.match(evidence.redAtBase.reason, /passes at the merge base too/);
  assert.equal(git(dir, ['status', '--porcelain']), status);
  assert.equal(worktreeCount(dir), 1);
});

// Fifteenth review: the base tree's commit must not run git's auto-maintenance
// on the user's repository (a gc that packs refs and prunes worktrees).
test('the base-tree commit never runs gc on the user\'s repository', (t) => {
  const dir = buggyBase(t);
  writeTest(dir, ADDING_TEST);
  fixed(dir);
  commit(dir, 'fix: add() adds, with a test');
  harnessConfig(dir, { command: 'node --test --test-reporter=tap {files}' });
  // A repository past its gc threshold, as a large one is.
  git(dir, ['config', 'gc.auto', '1']);
  git(dir, ['config', 'gc.autoDetach', 'false']);
  const blobs = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-red-blobs-'));
  t.after(() => fs.rmSync(blobs, { recursive: true, force: true }));
  // `gc --auto` samples `objects/17`: past the threshold once it holds two.
  const sample = path.join(dir, '.git', 'objects', '17');
  for (let batch = 0; !(fs.existsSync(sample) && fs.readdirSync(sample).length >= 2); batch += 1) {
    const names = Array.from({ length: 256 }, (_, i) => {
      const file = path.join(blobs, `b${batch}-${i}`);
      fs.writeFileSync(file, `blob ${batch} ${i}\n`);
      return file;
    });
    execFileSync('git', ['hash-object', '-w', ...names], { cwd: dir, stdio: 'ignore' });
  }
  const packs = () => fs.readdirSync(path.join(dir, '.git', 'objects', 'pack')).sort().join(',');
  const before = { refs: git(dir, ['for-each-ref']), packs: packs() };

  const { output, evidence } = verify(dir);

  assert.equal(evidence.redAtBase.ok, true, output);
  assert.equal(fs.existsSync(path.join(dir, '.git', 'packed-refs')), false);
  assert.deepEqual({ refs: git(dir, ['for-each-ref']), packs: packs() }, before);
});
