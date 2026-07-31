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

test('ci init writes the clean-room workflow with run/verify + audit', (t) => {
  const dir = project(t, 'ci-init');
  const res = run(dir, ['ci', 'init']);
  assert.equal(res.code, 0, res.output);

  const wf = fs.readFileSync(path.join(dir, WF), 'utf8');
  assert.match(wf, /name: coding-flow verify/);
  // Story-based repos are verified per story via `run`; the repo-wide
  // `harness verify` stays as the fallback for global-config projects.
  assert.match(wf, /\brun\b/, 'the workflow drives the per-story run orchestrator');
  assert.match(wf, /harness verify/, 'the repo-wide verify remains as a fallback');
  assert.match(wf, /audit --check/);
  assert.match(wf, /upload-artifact/, 'the evidence is uploaded');
});

test('ci init pins the workflow to the exact published version (reproducible gate)', (t) => {
  const dir = project(t, 'ci-pin');
  run(dir, ['ci', 'init']);

  const wf = fs.readFileSync(path.join(dir, WF), 'utf8');
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.match(
    wf,
    new RegExp(`@landry_pouth/coding-flow@${pkg.version.replace(/\./g, '\\.')}`),
    'the clean-room gate replays a pinned CLI version, not whatever is latest',
  );
  // Every npx invocation of the package must carry the pin — no bare/floating call.
  const floating = wf.match(/@landry_pouth\/coding-flow(?!@)/g);
  assert.equal(floating, null, 'no unpinned reference to the package may leak into the workflow');
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
