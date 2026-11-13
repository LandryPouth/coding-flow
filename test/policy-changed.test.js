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
  const json = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, 'utf8').replace(/^\uFEFF/, '')) : {};
  fs.writeFileSync(target, JSON.stringify(change(json), null, 2));
}

// `harness` is merged into harness.json in the base commit, before the branch.
// `branch: false` stays on main, the only branch: verify then has no merge base.
function repo(t, prefix, { strict = false, storyExtra = '', harness = {}, bom = false, branch = true } = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `coding-flow-${prefix}-`)));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(run(dir, ['init', '--minimal']).code, 0);
  editJson(dir, '.coding-flow/config.json', (c) => ({ ...c, validation: { commands: ['node -e "process.exit(0)"'], quality: [] } }));
  editJson(dir, '.coding-flow/harness.json', (h) => ({ ...h, ...(strict ? { mode: 'strict' } : {}), ...harness }));
  if (bom) {
    const file = path.join(dir, '.coding-flow/harness.json');
    fs.writeFileSync(file, `\uFEFF${fs.readFileSync(file, 'utf8')}`);
  }

  write(dir, `${STORY}/spec.md`, '# Widget\n\n## Acceptance Criteria\n\n- [x] Given X then Y\n');
  write(dir, `${STORY}/plan.md`, '# Plan\n');
  write(dir, '.eslintrc.json', '{"rules":{}}\n');
  git(dir, ['init', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-m', 'init']);
  if (branch) git(dir, ['checkout', '-b', 'feat/widget']);
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

test('a policyGlobs override present at the base replaces the defaults', (t) => {
  const dir = repo(t, 'pc-glob', { harness: { policyGlobs: ['custom.rules'] } });
  write(dir, '.eslintrc.json', '{"rules":{"x":"off"}}\n');
  write(dir, 'custom.rules', 'a\n');

  const res = verify(dir);
  assert.deepEqual(res.json.contrary.warnings.policyChanged, ['custom.rules']);
});

test('strict: emptying policyGlobs in the same diff that lowers the bar still fails', (t) => {
  // The globs that judge a diff come from the base: the diff cannot unlist itself.
  const dir = repo(t, 'pc-unlist', { strict: true });
  editJson(dir, '.coding-flow/harness.json', (h) => ({ ...h, minPatchCoverage: 0, policyGlobs: [] }));

  const res = verify(dir);
  assert.equal(res.code, 1, res.output);
  assert.deepEqual(res.json.contrary.warnings.policyChanged, ['.coding-flow/harness.json']);
  assert.ok(res.json.contrary.failures.some((f) => f.signal === 'policy-changed'));
});

test('the Coding Flow config files are policy files even when the base override omits them', (t) => {
  const dir = repo(t, 'pc-own', { harness: { policyGlobs: ['custom.rules'] } });
  editJson(dir, '.coding-flow/config.json', (c) => ({ ...c, validation: { commands: ['true'], quality: [] } }));

  const res = verify(dir);
  assert.deepEqual(res.json.contrary.warnings.policyChanged, ['.coding-flow/config.json']);
});

test('strict: lowering minPatchCoverage in harness.json fails, and a Policy Change section lets it pass', (t) => {
  const dir = repo(t, 'pc-harness-strict', { strict: true });
  editJson(dir, '.coding-flow/harness.json', (h) => ({ ...h, minPatchCoverage: 10 }));

  const failed = verify(dir);
  assert.equal(failed.code, 1, failed.output);
  assert.ok(failed.json.contrary.failures.some((f) => f.signal === 'policy-changed'));

  fs.appendFileSync(path.join(dir, STORY, 'spec.md'), '\n## Policy Change\n\nThe floor moved to the team-wide value.\n');
  const passed = verify(dir);
  assert.equal(passed.code, 0, passed.output);
  assert.match(passed.json.contrary.policyChange, /team-wide value/);
});

test('strict: renaming a policy file away is policy-changed and fails', (t) => {
  const dir = repo(t, 'pc-rename', { strict: true });
  git(dir, ['mv', '.eslintrc.json', 'eslintrc.bak.json']);

  const res = verify(dir);
  assert.equal(res.code, 1, res.output);
  assert.deepEqual(res.json.contrary.warnings.policyChanged, ['.eslintrc.json']);
  assert.ok(res.json.contrary.failures.some((f) => f.signal === 'policy-changed'));
});

test('strict: a Policy Change section holding only a comment or blanks gives no reason', (t) => {
  const dir = repo(t, 'pc-empty', { strict: true, storyExtra: '\n## Policy Change\n\n<!-- why the bar moved -->\n\n' });
  write(dir, '.eslintrc.json', '{"rules":{"no-undef":"off"}}\n');

  const res = verify(dir);
  assert.equal(res.code, 1, res.output);
  assert.ok(res.json.contrary.failures.some((f) => f.signal === 'policy-changed'));
  assert.equal(res.json.contrary.policyChange, undefined);
});

test('strict at the base: switching mode to standard in the diff does not soften the verdict', (t) => {
  const dir = repo(t, 'pc-mode', { strict: true });
  editJson(dir, '.coding-flow/harness.json', (h) => ({ ...h, mode: 'standard' }));

  const res = verify(dir);
  assert.equal(res.code, 1, res.output);
  assert.ok(res.json.contrary.failures.some((f) => f.signal === 'policy-changed'));
});

test('deleting a policy file and adding an untracked one are both policy-changed', (t) => {
  const dir = repo(t, 'pc-delete');
  fs.rmSync(path.join(dir, '.eslintrc.json'));
  write(dir, 'tsconfig.json', '{}\n');

  const res = verify(dir);
  assert.equal(res.code, 0, res.output);
  assert.deepEqual(res.json.contrary.warnings.policyChanged, ['.eslintrc.json', 'tsconfig.json']);
});

test('strict, working-tree scope: an uncommitted step-down and unlisting is judged against HEAD', (t) => {
  // On main alone there is no merge base: the diff is the working tree against
  // HEAD, and HEAD's harness.json is the bar.
  const dir = repo(t, 'pc-worktree', { strict: true, branch: false });
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-m', 'work']);
  editJson(dir, '.coding-flow/harness.json', (h) => ({ ...h, mode: 'standard', policyGlobs: [] }));
  write(dir, '.eslintrc.json', '{"rules":{"x":"off"}}\n');

  const res = run(dir, ['verify', '--no-cache', '--story', STORY, '--json']);
  const json = JSON.parse(res.output.slice(res.output.indexOf('{')));
  assert.equal(res.code, 1, res.output);
  assert.deepEqual(json.contrary.warnings.policyChanged, ['.coding-flow/harness.json', '.eslintrc.json']);
  assert.ok(json.contrary.failures.some((f) => f.signal === 'policy-changed'));
});

test('strict at the base is read through a byte-order mark', (t) => {
  const dir = repo(t, 'pc-bom', { strict: true, bom: true });
  editJson(dir, '.coding-flow/harness.json', (h) => ({ ...h, mode: 'standard' }));

  const res = verify(dir);
  assert.equal(res.code, 1, res.output);
  assert.ok(res.json.contrary.failures.some((f) => f.signal === 'policy-changed'));
});

test('strict: an unclosed comment in Policy Change gives no reason', (t) => {
  const dir = repo(t, 'pc-unclosed', { strict: true, storyExtra: '\n## Policy Change\n\n<!-- why the bar moved\n' });
  write(dir, '.eslintrc.json', '{"rules":{"no-undef":"off"}}\n');

  const res = verify(dir);
  assert.equal(res.code, 1, res.output);
  assert.ok(res.json.contrary.failures.some((f) => f.signal === 'policy-changed'));
  assert.equal(res.json.contrary.policyChange, undefined);
});

// failOnContrarySignals enforces only when the risk is high, and the risk is
// read from highRiskPaths, testGlobs and ignoredPaths: none of them may be
// lowered by the diff it judges.
const FAIL_ON_SRC = { failOnContrarySignals: true, highRiskPaths: ['src/**'] };

test('failOn at the base: a policy change on a high-risk diff fails', (t) => {
  const dir = repo(t, 'pc-failon', { harness: FAIL_ON_SRC });
  write(dir, '.eslintrc.json', '{"rules":{"x":"off"}}\n');

  const res = verify(dir);
  assert.equal(res.code, 1, res.output);
  assert.ok(res.json.contrary.failures.some((f) => f.signal === 'policy-changed'));
});

test('failOn at the base: emptying highRiskPaths in the diff still fails', (t) => {
  const dir = repo(t, 'pc-riskpaths', { harness: FAIL_ON_SRC });
  editJson(dir, '.coding-flow/harness.json', (h) => ({ ...h, highRiskPaths: [] }));
  write(dir, '.eslintrc.json', '{"rules":{"x":"off"}}\n');

  const res = verify(dir);
  assert.equal(res.code, 1, res.output);
  assert.ok(res.json.contrary.failures.some((f) => f.signal === 'policy-changed'));
});

test('failOn at the base: ignoring the high-risk paths in the diff still fails', (t) => {
  const dir = repo(t, 'pc-ignored', { harness: FAIL_ON_SRC });
  editJson(dir, '.coding-flow/harness.json', (h) => ({ ...h, ignoredPaths: ['src/**'] }));
  write(dir, '.eslintrc.json', '{"rules":{"x":"off"}}\n');

  const res = verify(dir);
  assert.equal(res.code, 1, res.output);
  assert.ok(res.json.contrary.failures.some((f) => f.signal === 'policy-changed'));
});

test('failOn at the base: calling an unguarded git merge a test file in the diff still fails', (t) => {
  // An unguarded git(…, ["merge"]) is a structural high-risk signal outside test files.
  const dir = repo(t, 'pc-testglobs', { harness: { failOnContrarySignals: true } });
  write(dir, 'src/land.js', 'git(root, ["merge", "feature"]);\n');
  editJson(dir, '.coding-flow/harness.json', (h) => ({ ...h, testGlobs: ['src/**'] }));
  write(dir, '.eslintrc.json', '{"rules":{"x":"off"}}\n');

  const res = verify(dir);
  assert.equal(res.code, 1, res.output);
  assert.ok(res.json.contrary.failures.some((f) => f.signal === 'policy-changed'));
});
