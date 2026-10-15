'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');
const { collectSignals, KNOWN_ENV_SIGNALS, KNOWN_DIR_SIGNALS } = require('../bin/lib/detect');

function project(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-signals-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function init(cwd, extraEnv = {}) {
  const env = { ...process.env, CLAUDE_CONFIG_DIR: path.join(cwd, '.no-claude-config'), CLAUDE_PLUGIN_ROOT: '', ...extraEnv };
  delete env.CLAUDECODE;
  return execFileSync(process.execPath, [CLI, 'init'], { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function platformRecords(dir) {
  const runs = path.join(dir, '.coding-flow', 'runs');
  return fs.readdirSync(runs).filter((n) => n.includes('-platform-')).map((n) => JSON.parse(fs.readFileSync(path.join(runs, n), 'utf8')));
}

test('an unrecognized init writes no platform files and records an unrecognized evidence entry', (t) => {
  const dir = project(t);
  init(dir);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, '.coding-flow', 'config.json'), 'utf8')).target, 'unrecognized');
  for (const d of ['.claude', '.codex', '.gemini', '.opencode', '.agent']) assert.equal(fs.existsSync(path.join(dir, d)), false, d);
  const [record] = platformRecords(dir);
  assert.equal(record.enforcementTier, 'unrecognized');
  assert.equal(record.target, 'unrecognized');
  assert.ok(Object.values(record.signals).every((v) => v === false));
});

test('a .gemini directory without a confirming signal is recorded, and detection still says unrecognized', (t) => {
  const dir = project(t);
  fs.mkdirSync(path.join(dir, '.gemini'));
  fs.mkdirSync(path.join(dir, '.config', 'opencode'), { recursive: true });
  init(dir);
  const [record] = platformRecords(dir);
  assert.equal(record.target, 'unrecognized');
  assert.equal(record.signals['dir:.gemini'], true);
  assert.equal(record.signals['dir:.config/opencode'], true);
  assert.equal(record.signals['dir:.codex'], false);
});

test('a .codex directory is a recognized signal (story 01-01), so it is codex, not unrecognized', (t) => {
  const dir = project(t);
  fs.mkdirSync(path.join(dir, '.codex'));
  init(dir);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, '.coding-flow', 'config.json'), 'utf8')).target, 'codex');
});

test('signals are booleans for allowlisted keys only; env values and unlisted vars are never captured', (t) => {
  const dir = project(t);
  fs.writeFileSync(path.join(dir, 'secret.txt'), 'TOP-SECRET-CONTENT');
  fs.mkdirSync(path.join(dir, '.gemini'));
  fs.writeFileSync(path.join(dir, '.gemini', 'settings.json'), 'TOP-SECRET-CONTENT');
  init(dir, { MY_API_KEY: 'sk-live-do-not-leak', SOME_UNLISTED_FLAG: '1' });
  const raw = fs.readdirSync(path.join(dir, '.coding-flow', 'runs'))
    .filter((n) => n.includes('-platform-'))
    .map((n) => fs.readFileSync(path.join(dir, '.coding-flow', 'runs', n), 'utf8'))
    .join('');
  assert.doesNotMatch(raw, /sk-live-do-not-leak|MY_API_KEY|SOME_UNLISTED_FLAG|TOP-SECRET|secret\.txt|settings\.json/);
  const [record] = platformRecords(dir);
  const expected = [...KNOWN_ENV_SIGNALS.map((n) => `env:${n}`), ...KNOWN_DIR_SIGNALS.map((n) => `dir:${n}`)].sort();
  assert.deepEqual(Object.keys(record.signals).sort(), expected);
  assert.ok(Object.values(record.signals).every((v) => typeof v === 'boolean'));
});

test('collectSignals reports an allowlisted env var as present without its value', () => {
  const signals = collectSignals({ env: { CLAUDECODE: '1', OTHER: 'x' }, cwd: os.tmpdir() });
  assert.equal(signals['env:CLAUDECODE'], true);
  assert.equal('env:OTHER' in signals, false);
});

test('re-running init on an unchanged unrecognized project adds no second record', (t) => {
  const dir = project(t);
  init(dir);
  init(dir);
  assert.equal(platformRecords(dir).length, 1);
});
