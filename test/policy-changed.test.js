'use strict';

// The bar does not move silently: a diff touching a policy file (lint, coverage
// threshold, harness.json) is the `policy-changed` contrary signal. A warning by
// default; strict fails unless a `## Policy Change` section or --policy-change
// gives the reason, which is kept in the evidence.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');
const STORY = 'epics/epic-01/story-01-01-widget';

function run(cwd, args) {
  try {
    const output = execFileSync(process.execPath, [CLI, ...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, output };
  } catch (err) {
    return { code: err.status ?? 1, output: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'ignore', 'ignore'] });
}

function write(dir, file, content) {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), content);
}

function editJson(dir, file, change) {
  const target = path.join(dir, file);
  const json = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, 'utf8')) : {};
  fs.writeFileSync(target, JSON.stringify(change(json), null, 2));
}

function repo(t, prefix, { strict = false, storyExtra = '' } = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `coding-flow-${prefix}-`)));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(run(dir, ['init', '--minimal']).code, 0);
  editJson(dir, '.coding-flow/config.json', (c) => ({ ...c, validation: { commands: ['node -e "process.exit(0)"'], quality: [] } }));
  if (strict) editJson(dir, '.coding-flow/harness.json', (h) => ({ ...h, mode: 'strict' }));

  write(dir, `${STORY}/spec.md`, '# Widget\n\n## Acceptance Criteria\n\n- [x] Given X then Y\n');
  write(dir, `${STORY}/plan.md`, '# Plan\n');
  write(dir, '.eslintrc.json', '{"rules":{}}\n');
  git(dir, ['init', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-m', 'init']);
  git(dir, ['checkout', '-b', 'feat/widget']);
  write(dir, 'src/widget.js', 'module.exports = 1;\n');
  write(dir, 'src/widget.test.js', 'assert(1);\n');
  if (storyExtra) fs.appendFileSync(path.join(dir, STORY, 'spec.md'), storyExtra);

  return dir;
}

function verify(dir, extra = []) {
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-m', 'work']);
  const res = run(dir, ['verify', '--no-cache', '--story', STORY, '--json', ...extra]);
  return { ...res, json: JSON.parse(res.output.slice(res.output.indexOf('{'))) };
}

test('lowering minPatchCoverage in harness.json is policy-changed, a warning naming the file', (t) => {
  const dir = repo(t, 'pc-harness');
  editJson(dir, '.coding-flow/harness.json', (h) => ({ ...h, minPatchCoverage: 10 }));

  const res = verify(dir);
  assert.equal(res.code, 0, res.output);
  assert.deepEqual(res.json.contrary.warnings.policyChanged, ['.coding-flow/harness.json']);
});

test('a rule added to .eslintrc.json raises the same signal: direction is not judged', (t) => {
  const dir = repo(t, 'pc-eslint');
  write(dir, '.eslintrc.json', '{"rules":{"no-undef":"error"}}\n');

  const res = verify(dir);
  assert.equal(res.code, 0, res.output);
  assert.deepEqual(res.json.contrary.warnings.policyChanged, ['.eslintrc.json']);
});

test('strict: policy-changed fails, and a Policy Change section lets it pass with the reason', (t) => {
  const dir = repo(t, 'pc-strict', { strict: true });
  write(dir, '.eslintrc.json', '{"rules":{"no-undef":"off"}}\n');

  const failed = verify(dir);
  assert.equal(failed.code, 1, failed.output);
  assert.ok(failed.json.contrary.failures.some((f) => f.signal === 'policy-changed'));

  fs.appendFileSync(path.join(dir, STORY, 'spec.md'), '\n## Policy Change\n\nno-undef fires on generated files.\n');
  const passed = verify(dir);
  assert.equal(passed.code, 0, passed.output);
  assert.match(passed.json.contrary.policyChange, /fires on generated files/);
});

test('strict: --policy-change carries the reason when there is no section, and needs one', (t) => {
  const dir = repo(t, 'pc-flag', { strict: true });
  write(dir, '.eslintrc.json', '{"rules":{"no-undef":"off"}}\n');

  const passed = verify(dir, ['--policy-change', 'vendored globals']);
  assert.equal(passed.code, 0, passed.output);
  assert.equal(passed.json.contrary.policyChange, 'vendored globals');

  const bare = run(dir, ['verify', '--no-cache', '--story', STORY, '--policy-change']);
  assert.notEqual(bare.code, 0);
  assert.match(bare.output, /--policy-change requires a reason/);
});

test('no policy file in the diff: no signal, and strict stays green', (t) => {
  const dir = repo(t, 'pc-none', { strict: true });

  const res = verify(dir);
  assert.equal(res.code, 0, res.output);
  assert.deepEqual(res.json.contrary.warnings.policyChanged, []);
  assert.equal(res.json.contrary.failures.length, 0);
});

test('a boundary checker config is a policy file by default', (t) => {
  // Loosening a dependency rule is how a boundary check passes by being moved.
  const { defaultPolicyGlobs } = require('../bin/lib/harness-config');
  for (const glob of ['**/.dependency-cruiser.*', '**/.importlinter*', '**/importlinter*', '**/eslint.config.*']) {
    assert.ok(defaultPolicyGlobs().includes(glob), glob);
  }

  const dir = repo(t, 'pc-boundary');
  write(dir, '.dependency-cruiser.cjs', 'module.exports = { forbidden: [] };\n');
  write(dir, '.importlinter', '[importlinter]\nroot_package = app\n');
  write(dir, 'importlinter.ini', '[importlinter]\nroot_package = app\n');
  write(dir, 'eslint.config.js', 'module.exports = [];\n');

  const res = verify(dir);
  assert.deepEqual(res.json.contrary.warnings.policyChanged, [
    '.dependency-cruiser.cjs',
    '.importlinter',
    'eslint.config.js',
    'importlinter.ini',
  ]);
});

test('a policyGlobs override replaces the defaults', (t) => {
  const dir = repo(t, 'pc-glob');
  editJson(dir, '.coding-flow/harness.json', (h) => ({ ...h, policyGlobs: ['custom.rules'] }));
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-m', 'glob']);
  write(dir, '.eslintrc.json', '{"rules":{"x":"off"}}\n');
  write(dir, 'custom.rules', 'a\n');

  const res = verify(dir);
  assert.deepEqual(res.json.contrary.warnings.policyChanged, ['custom.rules']);
});

test('deleting a policy file and adding an untracked one are both policy-changed', (t) => {
  const dir = repo(t, 'pc-delete');
  fs.rmSync(path.join(dir, '.eslintrc.json'));
  write(dir, 'tsconfig.json', '{}\n');

  const res = verify(dir);
  assert.equal(res.code, 0, res.output);
  assert.deepEqual(res.json.contrary.warnings.policyChanged, ['.eslintrc.json', 'tsconfig.json']);
});
