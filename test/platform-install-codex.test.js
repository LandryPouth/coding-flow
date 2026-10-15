'use strict';

// End to end: `ai-flow init` for a platform, through the real CLI.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');
const SKILLS = ['flow-next', 'flow-plan', 'flow-review', 'flow-run', 'flow-setup', 'flow-ship', 'flow-status'];

function project(t, dirs = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-platform-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const name of dirs) fs.mkdirSync(path.join(dir, name));
  return dir;
}

// A bare environment: nothing says which platform is hosting the CLI.
function init(cwd, args = []) {
  const env = { ...process.env, CLAUDE_CONFIG_DIR: path.join(cwd, '.no-claude-config'), CLAUDE_PLUGIN_ROOT: '' };
  delete env.CLAUDECODE;
  return execFileSync(process.execPath, [CLI, 'init', ...args], { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function config(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, '.coding-flow', 'config.json'), 'utf8'));
}

function platformRecords(dir) {
  const runs = path.join(dir, '.coding-flow', 'runs');
  if (!fs.existsSync(runs)) return [];
  return fs.readdirSync(runs).map((name) => JSON.parse(fs.readFileSync(path.join(runs, name), 'utf8'))).filter((r) => r.kind === 'platform');
}

test('init --target codex records the target and renders one skill per coding-flow skill', (t) => {
  const dir = project(t);
  init(dir, ['--target', 'codex']);
  assert.equal(config(dir).target, 'codex');
  const written = fs.readdirSync(path.join(dir, '.codex', 'skills')).sort();
  assert.deepEqual(written, SKILLS);
  for (const name of SKILLS) assert.ok(fs.existsSync(path.join(dir, '.codex', 'skills', name, 'SKILL.md')));
});

test('the Codex skills are adapted: invoked as $flow-*, never pointing at .claude/', (t) => {
  const dir = project(t);
  init(dir, ['--target', 'codex']);
  const run = fs.readFileSync(path.join(dir, '.codex', 'skills', 'flow-run', 'SKILL.md'), 'utf8');
  assert.match(run, /^---\nname: flow-run\n/);
  assert.match(run, /\$flow-/);
  assert.doesNotMatch(run, /(^|[\s`(])\/flow-/m);
  assert.doesNotMatch(run, /\.claude\//);
});

test('a Codex install writes no Claude-specific file', (t) => {
  const dir = project(t);
  init(dir, ['--target', 'codex']);
  assert.equal(fs.existsSync(path.join(dir, '.claude')), false);
  assert.equal(fs.existsSync(path.join(dir, 'CLAUDE.md')), false);
});

test('init with no flag, no env signal and no platform directory is "unrecognized" and writes no commands', (t) => {
  const dir = project(t);
  const out = init(dir);
  assert.equal(config(dir).target, 'unrecognized');
  assert.equal(fs.existsSync(path.join(dir, '.codex')), false);
  assert.equal(fs.existsSync(path.join(dir, '.claude')), false);
  assert.match(out, /Platform not recognized/);
  const [record] = platformRecords(dir);
  assert.equal(record.target, 'unrecognized');
  assert.equal(record.commandsInstalled, 0);
});

test('init --target codex twice is idempotent: nothing duplicated or rewritten', (t) => {
  const dir = project(t);
  init(dir, ['--target', 'codex']);
  const file = path.join(dir, '.codex', 'skills', 'flow-run', 'SKILL.md');
  fs.appendFileSync(file, '\nlocal edit\n');
  const before = fs.readFileSync(file, 'utf8');
  init(dir, ['--target', 'codex']);
  assert.equal(fs.readFileSync(file, 'utf8'), before, 'a second run must not clobber an existing command file');
  assert.deepEqual(fs.readdirSync(path.join(dir, '.codex', 'skills')).sort(), SKILLS);
});

test('a prior Claude install is left untouched, Codex is added alongside and the new target is recorded', (t) => {
  const dir = project(t);
  init(dir, ['--target', 'claude', '--with-skills']);
  const claudeSkill = path.join(dir, '.claude', 'skills', 'flow-run', 'SKILL.md');
  const settings = path.join(dir, '.claude', 'settings.json');
  const before = [fs.readFileSync(claudeSkill, 'utf8'), fs.readFileSync(settings, 'utf8')];
  init(dir, ['--target', 'codex']);
  assert.deepEqual([fs.readFileSync(claudeSkill, 'utf8'), fs.readFileSync(settings, 'utf8')], before);
  assert.ok(fs.existsSync(path.join(dir, '.codex', 'skills', 'flow-run', 'SKILL.md')));
  assert.equal(config(dir).target, 'codex', 'an explicit --target is recorded, so doctor/upgrade/report agree with the files');
});

test('an "unrecognized" install is replaced by the first explicit target', (t) => {
  const dir = project(t);
  init(dir);
  init(dir, ['--target', 'codex']);
  assert.equal(config(dir).target, 'codex');
  assert.equal(fs.readdirSync(path.join(dir, '.codex', 'skills')).length, SKILLS.length);
});

test('init --target codex records platform evidence with commands-only enforcement', (t) => {
  const dir = project(t);
  init(dir, ['--target', 'codex']);
  const [record] = platformRecords(dir);
  assert.equal(record.target, 'codex');
  assert.equal(record.detectionSource, 'flag');
  assert.equal(record.commandsInstalled, 7);
  assert.equal(record.enforcementTier, 'commands-only');
});

test('an unknown --target is refused with the accepted values', (t) => {
  const dir = project(t);
  assert.throws(() => init(dir, ['--target', 'emacs']), (err) => /claude, codex/.test(`${err.stderr}`));
});

test('doctor judges a Codex install against its own files, not CLAUDE.md', (t) => {
  const dir = project(t);
  init(dir, ['--target', 'codex']);
  const env = { ...process.env, CLAUDE_CONFIG_DIR: path.join(dir, '.no-claude-config'), CLAUDE_PLUGIN_ROOT: '' };
  const out = execFileSync(process.execPath, [CLI, 'doctor', '--json'], { cwd: dir, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const files = JSON.parse(out).errors.map((e) => e.file);
  assert.equal(files.includes('CLAUDE.md'), false);
  assert.equal(files.some((f) => String(f).startsWith('.codex/')), false);
});

function cli(cwd, args) {
  const env = { ...process.env, CLAUDE_CONFIG_DIR: path.join(cwd, '.no-claude-config'), CLAUDE_PLUGIN_ROOT: '' };
  delete env.CLAUDECODE;
  return execFileSync(process.execPath, [CLI, ...args], { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

test('upgrade on a Codex project creates no Claude file and restores a missing Codex command', (t) => {
  const dir = project(t);
  init(dir, ['--target', 'codex']);
  fs.rmSync(path.join(dir, '.codex', 'skills', 'flow-ship'), { recursive: true });
  cli(dir, ['upgrade']);
  assert.equal(fs.existsSync(path.join(dir, '.claude')), false);
  assert.equal(fs.existsSync(path.join(dir, 'CLAUDE.md')), false);
  assert.ok(fs.existsSync(path.join(dir, '.codex', 'skills', 'flow-ship', 'SKILL.md')));
});

test('doctor --fix on a Codex project restores Codex commands and creates no Claude file', (t) => {
  const dir = project(t);
  init(dir, ['--target', 'codex']);
  fs.rmSync(path.join(dir, '.codex', 'skills', 'flow-run'), { recursive: true });
  cli(dir, ['doctor', '--fix']);
  assert.equal(fs.existsSync(path.join(dir, '.claude')), false);
  assert.equal(fs.existsSync(path.join(dir, 'CLAUDE.md')), false);
  assert.ok(fs.existsSync(path.join(dir, '.codex', 'skills', 'flow-run', 'SKILL.md')));
});

test('doctor warns that an unrecognized install has no commands and no guard, without failing it', (t) => {
  const dir = project(t);
  init(dir);
  const report = JSON.parse(cli(dir, ['doctor', '--json']));
  assert.ok(report.warnings.some((w) => w.code === 'platform_unrecognized'));
  assert.equal(report.errors.some((e) => e.code === 'guard_not_wired'), false);
});

test('upgrade on an unrecognized project writes no Claude file either', (t) => {
  const dir = project(t);
  init(dir);
  cli(dir, ['upgrade']);
  assert.equal(fs.existsSync(path.join(dir, '.claude')), false);
  assert.equal(fs.existsSync(path.join(dir, 'CLAUDE.md')), false);
});
