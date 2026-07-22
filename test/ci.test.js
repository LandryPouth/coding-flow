'use strict';

// Tests of `ai-flow ci init`: scaffolds the clean-room workflow, non-destructive,
// idempotent, --force rewrites, --dry-run writes nothing.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');
const WF = path.join('.github', 'workflows', 'coding-flow-verify.yml');

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

function project(t, prefix) {
  const dir = tmp(prefix);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('ci init writes the clean-room workflow with verify + audit', (t) => {
  const dir = project(t, 'ci-init');
  const res = run(dir, ['ci', 'init']);
  assert.equal(res.code, 0, res.output);

  const wf = fs.readFileSync(path.join(dir, WF), 'utf8');
  assert.match(wf, /name: coding-flow verify/);
  assert.match(wf, /harness verify/);
  assert.match(wf, /audit --check/);
  assert.match(wf, /@landry_pouth\/coding-flow/, 'the workflow targets the published package');
  assert.match(wf, /upload-artifact/, 'the evidence is uploaded');
});

test('ci init is non-destructive without --force', (t) => {
  const dir = project(t, 'ci-noforce');
  fs.mkdirSync(path.join(dir, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(dir, WF), 'custom: true\n');

  const res = run(dir, ['ci', 'init']);
  assert.equal(res.code, 0);
  assert.match(res.output, /already present/);
  assert.equal(fs.readFileSync(path.join(dir, WF), 'utf8'), 'custom: true\n', 'the existing file is preserved');
});

test('ci init --force rewrites the workflow', (t) => {
  const dir = project(t, 'ci-force');
  fs.mkdirSync(path.join(dir, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(dir, WF), 'custom: true\n');

  run(dir, ['ci', 'init', '--force']);
  assert.match(fs.readFileSync(path.join(dir, WF), 'utf8'), /coding-flow verify/, '--force replaces the content');
});

test('ci init --dry-run writes nothing', (t) => {
  const dir = project(t, 'ci-dry');
  const res = run(dir, ['ci', 'init', '--dry-run']);
  assert.equal(res.code, 0);
  assert.match(res.output, /Would write/);
  assert.ok(!fs.existsSync(path.join(dir, WF)), '--dry-run must not write any file');
});
