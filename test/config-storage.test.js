'use strict';

// Contract tests for the storage seam, the .coding-flow/config.json config, and
// the branchPerEpic policy. We run the real CLI in temporary directories.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `coding-flow-${prefix}-`));
}

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

function sh(cwd, cmd, args) {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function readConfig(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, '.coding-flow', 'config.json'), 'utf8'));
}

test('init writes config.json with storage=local and branchPerEpic=true', (t) => {
  const dir = tmp('init');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const { code, output } = run(dir, ['init']);
  assert.equal(code, 0, output);

  const config = readConfig(dir);
  assert.equal(config.storage, 'local');
  assert.equal(config.branchPerEpic, true);
  assert.match(output, /Config: created/);
});

test('init --no-branch-per-epic disables the policy', (t) => {
  const dir = tmp('init-nopolicy');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const { code } = run(dir, ['init', '--no-branch-per-epic']);
  assert.equal(code, 0);
  assert.equal(readConfig(dir).branchPerEpic, false);
});

test('init --storage github is refused and writes no config', (t) => {
  const dir = tmp('init-github');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const { code, output } = run(dir, ['init', '--storage', 'github']);
  assert.notEqual(code, 0, 'github storage must be refused');
  assert.match(output, /github/i);
  assert.ok(
    !fs.existsSync(path.join(dir, '.coding-flow', 'config.json')),
    'no config must be written when init is refused',
  );
});

test('init --storage unknown is refused', (t) => {
  const dir = tmp('init-bogus');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const { code, output } = run(dir, ['init', '--storage', 'sqlite']);
  assert.notEqual(code, 0);
  assert.match(output, /storage/i);
});

test('status --json exposes storage and policy', (t) => {
  const dir = tmp('status-json');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  run(dir, ['init']);

  const { code, output } = run(dir, ['status', '--json']);
  assert.equal(code, 0, output);
  const data = JSON.parse(output);
  assert.equal(data.storage, 'local');
  assert.equal(data.policy.branchPerEpic, true);
  assert.ok(Object.prototype.hasOwnProperty.call(data.policy, 'onBase'));
});

test('status fails cleanly when storage is set to github (seam proven)', (t) => {
  const dir = tmp('status-github');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  run(dir, ['init']);
  const configPath = path.join(dir, '.coding-flow', 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.storage = 'github';
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

  const { code, output } = run(dir, ['status', '--json']);
  assert.notEqual(code, 0, 'the unimplemented github backend must fail');
  assert.match(output, /github/i);
});

test('status flags being on the base branch under branchPerEpic', (t) => {
  const dir = tmp('status-policy');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  sh(dir, 'git', ['-c', 'init.defaultBranch=main', 'init']);
  sh(dir, 'git', ['config', 'user.email', 't@e.com']);
  sh(dir, 'git', ['config', 'user.name', 'T']);
  run(dir, ['init']);
  sh(dir, 'git', ['add', '.']);
  sh(dir, 'git', ['commit', '-m', 'init']);

  const { output } = run(dir, ['status', '--json']);
  const data = JSON.parse(output);
  assert.equal(data.policy.branch, 'main');
  assert.equal(data.policy.onBase, true);

  const text = run(dir, ['status']);
  assert.match(text.output, /branchPerEpic/i, 'the policy reminder must appear in text');
});

test('upgrade creates config.json for a project installed before the seam', (t) => {
  const dir = tmp('upgrade-migrate');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  run(dir, ['init']);
  // Simulate an old project: we delete the config but keep the rest.
  fs.rmSync(path.join(dir, '.coding-flow', 'config.json'));

  const { code } = run(dir, ['upgrade']);
  assert.equal(code, 0);
  assert.equal(readConfig(dir).storage, 'local');
});
