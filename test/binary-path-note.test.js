'use strict';

// "Some commands fail because the binary is not installed" is a support gap,
// not a code defect: bare `ai-flow` only resolves when it was installed
// globally, and nothing told the user that before they hit `command not
// found`. `init`, `upgrade`, and `doctor` now all answer "will the short
// form work on this machine" with the same note, so the answer is
// impossible to have missed however you arrived at it.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { isCommandAvailable, binaryPathNote } = require('../bin/lib/util');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `coding-flow-${prefix}-`));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('isCommandAvailable is true for a command that actually resolves', () => {
  assert.equal(isCommandAvailable('node'), true);
});

test('isCommandAvailable is false for a name nothing on PATH provides', () => {
  assert.equal(isCommandAvailable('coding-flow-does-not-exist-4f3c9a'), false);
});

test('binaryPathNote says the short form works when the binary is on PATH', () => {
  assert.match(binaryPathNote(true), /resolves directly on this machine/);
  assert.match(binaryPathNote(true), /^PATH:/);
});

test('binaryPathNote points at npx and the global install when it is not', () => {
  const note = binaryPathNote(false);
  assert.match(note, /not on this machine's PATH/);
  assert.match(note, /npx @landry_pouth\/coding-flow/);
  assert.match(note, /npm install -g @landry_pouth\/coding-flow/);
});

test('doctor --json reports binaryOnPath as the boolean isCommandAvailable would give', (t) => {
  const dir = project(t, 'doctor-binary-json');
  assert.equal(run(dir, ['init']).code, 0);

  const res = run(dir, ['doctor', '--json']);
  assert.equal(res.code, 0, res.output);
  const report = JSON.parse(res.output);
  assert.equal(report.binaryOnPath, isCommandAvailable('ai-flow'));
});

test('doctor plain text prints the PATH note on a clean install', (t) => {
  const dir = project(t, 'doctor-binary-ok');
  assert.equal(run(dir, ['init']).code, 0);

  const { code, output } = run(dir, ['doctor']);
  assert.equal(code, 0, output);
  assert.match(output, /^PATH:/m);
});

test('doctor plain text prints the PATH note even when the install has issues', (t) => {
  const dir = project(t, 'doctor-binary-issues');
  assert.equal(run(dir, ['init']).code, 0);
  fs.rmSync(path.join(dir, 'RULES.md'));

  const { code, output } = run(dir, ['doctor']);
  assert.equal(code, 1, output);
  assert.match(output, /^PATH:/m);
});

test('init prints the PATH note at the end of a fresh install', (t) => {
  const dir = project(t, 'init-binary');

  const { code, output } = run(dir, ['init']);
  assert.equal(code, 0, output);
  assert.match(output, /^PATH:/m);
});

test('upgrade prints the PATH note in plain text mode', (t) => {
  const dir = project(t, 'upgrade-binary');
  assert.equal(run(dir, ['init']).code, 0);

  const { code, output } = run(dir, ['upgrade']);
  assert.equal(code, 0, output);
  assert.match(output, /^PATH:/m);
});

test('upgrade --json stays pure JSON, no PATH note mixed in', (t) => {
  const dir = project(t, 'upgrade-binary-json');
  assert.equal(run(dir, ['init']).code, 0);

  const { code, output } = run(dir, ['upgrade', '--json']);
  assert.equal(code, 0, output);
  assert.doesNotThrow(() => JSON.parse(output));
});
