'use strict';

// Contract tests for template installation / update.
// init/upgrade/uninstall write and delete files in the user's repo: they are the
// most destructive operations of the CLI. We verify the manifest, the npm
// scripts, respect for an existing package.json, and the harmlessness of
// --dry-run. Zero dependency: node:test.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');

function freshProject(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-tpl-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
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

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

test('init writes the manifest and the cheat sheet', (t) => {
  const dir = freshProject(t);
  run(dir, ['init']);
  assert.ok(fs.existsSync(path.join(dir, '.coding-flow', 'manifest.json')), 'manifest.json must exist');
  assert.ok(fs.existsSync(path.join(dir, '.coding-flow', 'COMMANDS.md')), 'COMMANDS.md must exist');

  const manifest = readJson(path.join(dir, '.coding-flow', 'manifest.json'));
  assert.ok(manifest.files && Object.keys(manifest.files).length > 0, 'the manifest must index files');
});

test('init adds the flow:* scripts to package.json', (t) => {
  const dir = freshProject(t);
  run(dir, ['init']);
  const pkg = readJson(path.join(dir, 'package.json'));
  assert.ok(pkg.scripts, 'package.json must have scripts');
  assert.ok(pkg.scripts['flow:doctor'], 'flow:doctor must be added');
  assert.ok(pkg.scripts['flow:status'], 'flow:status must be added');
});

test('init preserves an existing package.json and its scripts', (t) => {
  const dir = freshProject(t);
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'my-app', scripts: { dev: 'vite' } }, null, 2),
  );

  run(dir, ['init']);
  const pkg = readJson(path.join(dir, 'package.json'));
  assert.equal(pkg.name, 'my-app', 'the existing name must be preserved');
  assert.equal(pkg.scripts.dev, 'vite', 'an existing script must never be overwritten');
  assert.ok(pkg.scripts['flow:doctor'], 'the flow:* scripts must still be added');
});

test('upgrade --json returns an actionable report', (t) => {
  const dir = freshProject(t);
  run(dir, ['init']);
  const { code, output } = run(dir, ['upgrade', '--json']);
  assert.equal(code, 0, 'upgrade must exit 0');

  const report = JSON.parse(output);
  for (const key of ['copied', 'updated', 'skippedModified', 'unchanged']) {
    assert.ok(Array.isArray(report[key]), `the upgrade report must expose ${key} as an array`);
  }
});

test('upgrade restores a deleted managed file', (t) => {
  const dir = freshProject(t);
  run(dir, ['init']);
  const target = path.join(dir, 'RULES.md');
  fs.unlinkSync(target);

  run(dir, ['upgrade']);
  assert.ok(fs.existsSync(target), 'upgrade must re-copy a missing managed file');
});

test('uninstall --dry-run deletes no file', (t) => {
  const dir = freshProject(t);
  run(dir, ['init']);
  const marker = path.join(dir, 'RULES.md');
  assert.ok(fs.existsSync(marker), 'pre-condition: the file exists after init');

  const { code } = run(dir, ['uninstall', '--dry-run']);
  assert.equal(code, 0, 'uninstall --dry-run must exit 0');
  assert.ok(fs.existsSync(marker), '--dry-run must delete nothing');
});
