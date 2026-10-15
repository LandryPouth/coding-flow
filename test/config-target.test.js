'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { TARGETS, ensureConfig, readConfig, writeConfigTarget, configPath } = require('../bin/lib/config');

function project(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-config-target-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writeRaw(dir, value) {
  fs.mkdirSync(path.join(dir, '.coding-flow'), { recursive: true });
  fs.writeFileSync(configPath(dir), JSON.stringify(value));
}

test('TARGETS is exactly the values the platforms support, plus unrecognized', () => {
  assert.deepEqual(TARGETS, ['claude', 'codex', 'gemini', 'opencode', 'antigravity', 'unrecognized']);
});

test('ensureConfig records the target once and never overwrites it', (t) => {
  const dir = project(t);
  assert.equal(ensureConfig(dir, { target: 'codex' }).config.target, 'codex');
  const again = ensureConfig(dir, { target: 'claude' });
  assert.equal(again.created, false);
  assert.equal(again.config.target, 'codex');
});

test('a config written before the field existed reads as claude', (t) => {
  const dir = project(t);
  writeRaw(dir, { version: 1, storage: 'local' });
  assert.equal(readConfig(dir).target, 'claude');
});

test('an invalid target value falls back to "unrecognized"', (t) => {
  const dir = project(t);
  writeRaw(dir, { version: 1, target: 'vscode' });
  assert.equal(readConfig(dir).target, 'unrecognized');
});

test('writeConfigTarget refuses a value outside TARGETS and keeps the rest of the config', (t) => {
  const dir = project(t);
  ensureConfig(dir, { target: 'unrecognized', skills: 'plugin' });
  assert.equal(writeConfigTarget(dir, 'nonsense', 'project').target, 'unrecognized');
  const next = writeConfigTarget(dir, 'codex', 'plugin');
  assert.equal(next.target, 'codex');
  assert.equal(readConfig(dir).storage, 'local');
});
