'use strict';

// `blockedPaths` written explicitly replaces the defaults, so an install from before
// the evidence entries existed would let an agent edit its own proof. `doctor` says
// so; it does not rewrite a list the user owns.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');

function doctor(cwd) {
  const out = execFileSync(process.execPath, [CLI, 'doctor', '--json'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return JSON.parse(out).warnings.filter((w) => w.code === 'evidence_writable');
}

function project(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-evblocked-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  execFileSync(process.execPath, [CLI, 'init'], { cwd: dir, stdio: 'ignore' });
  return dir;
}

test('a fresh install has the evidence paths blocked and no warning', (t) => {
  assert.deepEqual(doctor(project(t)), []);
});

test('an explicit blockedPaths without the evidence entries is warned about and left untouched', (t) => {
  const dir = project(t);
  const file = path.join(dir, '.coding-flow', 'harness.json');
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  config.blockedPaths = ['.env'];
  fs.writeFileSync(file, JSON.stringify(config, null, 2));
  const before = fs.readFileSync(file, 'utf8');

  const found = doctor(dir);
  assert.equal(found.length, 1);
  assert.match(found[0].message, /\.coding-flow\/runs\/\*\*/);
  assert.match(found[0].message, /\.coding-flow\/ledger\.jsonl/);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('an equivalent glob of the user\'s own covers the evidence paths: no warning', (t) => {
  const dir = project(t);
  const file = path.join(dir, '.coding-flow', 'harness.json');
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  config.blockedPaths = ['.env', '.coding-flow/runs/*', '.coding-flow/**'];
  fs.writeFileSync(file, JSON.stringify(config, null, 2));
  assert.deepEqual(doctor(dir), []);
});
