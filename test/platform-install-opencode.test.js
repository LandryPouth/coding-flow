'use strict';

const { defineSuite } = require('../test-support/commands-only-suite');

defineSuite({
  target: 'opencode',
  files: (name) => `.opencode/command/${name}.md`,
  parser: 'yaml',
  describe: (parsed) => parsed.description,
});

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');

function initOpenCode(t, extra) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-oc-msg-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const run = (args) => execFileSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const out = run(['init', '--target', 'opencode', ...extra]);
  let doctor = '';
  try { doctor = run(['doctor']); } catch (err) { doctor = `${err.stdout || ''}${err.stderr || ''}`; }
  return { dir, out, doctor };
}

test('opencode: --target opencode wires the guard plugin by default, and says so', (t) => {
  const { dir, out, doctor } = initOpenCode(t, []);
  assert.match(out, /Guard plugin \(OpenCode\): wired/);
  assert.doesNotMatch(out, /Guard hook: none|not mechanically protected/);
  assert.doesNotMatch(doctor, /guard not available/);
  assert.ok(fs.existsSync(path.join(dir, '.opencode', 'plugins', 'coding-flow-guard.js')));
});

test('opencode: --no-guard opts out, says so, and doctor then flags the hole', (t) => {
  const { dir, out } = initOpenCode(t, ['--no-guard']);
  assert.match(out, /Guard: skipped \(--no-guard\)/);
  assert.equal(fs.existsSync(path.join(dir, '.opencode', 'plugins')), false);
  // doctor exits non-zero on an error, which is the point here.
  const res = require('node:child_process').spawnSync(process.execPath, [CLI, 'doctor', '--json'], { cwd: dir, encoding: 'utf8' });
  assert.notEqual(res.status, 0);
  const doctor = JSON.parse(res.stdout);
  assert.ok(doctor.errors.some((e) => e.code === 'opencode_guard_not_wired'));
});

test('opencode: --opencode is still accepted and changes nothing on this target', (t) => {
  const { out } = initOpenCode(t, ['--opencode']);
  assert.match(out, /Guard plugin \(OpenCode\): wired/);
});
