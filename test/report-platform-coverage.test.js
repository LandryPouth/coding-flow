'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');

function project(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-report-platform-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function cli(cwd, args) {
  const env = { ...process.env, CLAUDE_CONFIG_DIR: path.join(cwd, '.no-claude-config'), CLAUDE_PLUGIN_ROOT: '' };
  delete env.CLAUDECODE;
  return execFileSync(process.execPath, [CLI, ...args], { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

test('report lists a Codex install under "Platform coverage" with its enforcement tier', (t) => {
  const dir = project(t);
  cli(dir, ['init', '--target', 'codex']);
  const out = cli(dir, ['report']);
  const section = out.split('## Platform coverage')[1].split('## Guard denials')[0];
  assert.match(section, /\| codex \|/);
  assert.match(section, /enforcementTier: commands-only/);
});

test('report says so when no platform install was ever recorded', (t) => {
  const dir = project(t);
  fs.mkdirSync(path.join(dir, '.coding-flow'), { recursive: true });
  const out = cli(dir, ['report']);
  assert.match(out.split('## Platform coverage')[1].split('## Guard denials')[0], /None recorded/);
});

test('an evidence file written before records carried a kind is still classified by its filename', (t) => {
  const dir = project(t);
  const runs = path.join(dir, '.coding-flow', 'runs');
  fs.mkdirSync(runs, { recursive: true });
  fs.writeFileSync(
    path.join(runs, '2026-01-01T00-00-00-000Z-verify.json'),
    JSON.stringify({ ok: false, generatedAt: '2026-01-01T00:00:00.000Z', results: [{ command: 'npm test', ok: false, exitCode: 1 }] }),
  );
  const report = JSON.parse(cli(dir, ['report', '--json']));
  assert.equal(report.activity.verifyRuns, 1);
  assert.equal(report.activity.verifyRed, 1);
  assert.equal(report.platformCoverage.length, 0);
});

test('a record that declares its own kind wins over its filename', (t) => {
  const dir = project(t);
  const runs = path.join(dir, '.coding-flow', 'runs');
  fs.mkdirSync(runs, { recursive: true });
  fs.writeFileSync(
    path.join(runs, 'x-verify-looking-name.json'),
    JSON.stringify({ kind: 'platform', target: 'codex', detectionSource: 'flag', commandsInstalled: 7, enforcementTier: 'commands-only' }),
  );
  const report = JSON.parse(cli(dir, ['report', '--json']));
  assert.equal(report.activity.verifyRuns, 0);
  assert.equal(report.platformCoverage[0].target, 'codex');
});

function writePlatformRecord(dir, name, record) {
  const runs = path.join(dir, '.coding-flow', 'runs');
  fs.mkdirSync(runs, { recursive: true });
  fs.writeFileSync(path.join(runs, name), JSON.stringify({ kind: 'platform', commandsInstalled: 0, ...record }));
}

test('report shows an unrecognized line with a count and the signals seen', (t) => {
  const dir = project(t);
  const signals = { 'env:CLAUDECODE': false, 'dir:.claude': false, 'dir:.codex': false, 'dir:.gemini': true, 'dir:.config/opencode': false };
  writePlatformRecord(dir, 'a-platform-unrecognized.json', { target: 'unrecognized', detectionSource: 'none', enforcementTier: 'unrecognized', signals });
  writePlatformRecord(dir, 'b-platform-unrecognized.json', { target: 'unrecognized', detectionSource: 'none', enforcementTier: 'unrecognized', signals });
  const section = cli(dir, ['report']).split('## Platform coverage')[1].split('## Guard denials')[0];
  assert.match(section, /\*\*unrecognized\*\* — 2 install/);
  assert.match(section, /dir:\.gemini 2\/2/);
  assert.match(section, /dir:\.codex 0\/2/);
});

test('report has no unrecognized line when no unrecognized record exists', (t) => {
  const dir = project(t);
  cli(dir, ['init', '--target', 'codex']);
  const section = cli(dir, ['report']).split('## Platform coverage')[1].split('## Guard denials')[0];
  assert.doesNotMatch(section, /unrecognized/);
});

test('an old unrecognized record missing a since-added signal reads as "not checked", not an error', (t) => {
  const dir = project(t);
  writePlatformRecord(dir, 'a-platform-unrecognized.json', { target: 'unrecognized', enforcementTier: 'unrecognized', signals: { 'dir:.gemini': true } });
  writePlatformRecord(dir, 'b-platform-unrecognized.json', { target: 'unrecognized', enforcementTier: 'none' });
  const out = cli(dir, ['report']);
  const section = out.split('## Platform coverage')[1].split('## Guard denials')[0];
  assert.match(section, /dir:\.gemini 1\/1 \(not checked in 1\)/);
  assert.match(section, /dir:\.codex not checked/);
  assert.equal(JSON.parse(cli(dir, ['report', '--json'])).unrecognized.count, 2);
});
