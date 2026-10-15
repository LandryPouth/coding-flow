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
