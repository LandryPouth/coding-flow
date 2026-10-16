'use strict';

// uninstall used to remove the template files and leave every guard behind: the
// Claude hook, the Codex sandbox profile and the OpenCode plugin kept refusing
// writes in a project that no longer had Coding Flow, and the rendered Codex /
// OpenCode skills stayed. These pin the full take-back — and that a user's own
// settings in the same files survive it untouched.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');

function project(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-uninstall-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const env = { ...process.env, CLAUDE_CONFIG_DIR: path.join(dir, '.no-claude-config'), CLAUDE_PLUGIN_ROOT: '' };
  delete env.CLAUDECODE;
  delete env.OPENCODE;
  const run = (args) => execFileSync(process.execPath, [CLI, ...args], { cwd: dir, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return { dir, run };
}

function files(dir) {
  const out = [];
  const walk = (d) => {
    for (const name of fs.readdirSync(d)) {
      if (name === '.no-claude-config') continue;
      const p = path.join(d, name);
      if (fs.statSync(p).isDirectory()) walk(p);
      else out.push(path.relative(dir, p).split(path.sep).join('/'));
    }
  };
  walk(dir);
  return out.sort();
}

test('uninstall takes back every platform: skills, guards, rules pointer, config', (t) => {
  const { dir, run } = project(t);
  run(['init', '--target', 'claude', '--with-skills']);
  run(['init', '--target', 'opencode']);
  run(['init', '--target', 'codex']);
  assert.ok(fs.existsSync(path.join(dir, '.codex', 'skills', 'flow-run', 'SKILL.md')));

  const out = run(['uninstall']);
  assert.match(out, /Unwired: guard hook removed from \.claude\/settings\.json/);
  assert.match(out, /Unwired: sandbox profile \.codex\/config\.toml removed/);
  assert.match(out, /Unwired: guard plugin \.opencode\/plugins\/coding-flow-guard\.js removed/);
  assert.deepEqual(files(dir), ['epics/.gitkeep']);
});

test('uninstall keeps what the user put in the same files', (t) => {
  const { dir, run } = project(t);
  fs.mkdirSync(path.join(dir, '.claude'));
  fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), JSON.stringify({ theme: 'dark' }));
  fs.writeFileSync(path.join(dir, 'opencode.json'), JSON.stringify({ $schema: 'https://opencode.ai/config.json', model: 'x/y' }));
  run(['init', '--target', 'claude', '--with-skills']);
  run(['init', '--target', 'opencode']);

  run(['uninstall']);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8')), { theme: 'dark' });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'opencode.json'), 'utf8')), {
    $schema: 'https://opencode.ai/config.json',
    model: 'x/y',
  });
});

test('uninstall --dry-run unwires nothing', (t) => {
  const { dir, run } = project(t);
  run(['init', '--target', 'opencode']);
  const out = run(['uninstall', '--dry-run']);
  assert.match(out, /Would unwire: guard plugin/);
  assert.ok(fs.existsSync(path.join(dir, '.opencode', 'plugins', 'coding-flow-guard.js')));
  assert.ok(fs.existsSync(path.join(dir, '.opencode', 'skills', 'flow-run', 'SKILL.md')));
});

test('an edited rendered skill blocks uninstall like an edited template does', (t) => {
  const { dir, run } = project(t);
  run(['init', '--target', 'opencode']);
  fs.appendFileSync(path.join(dir, '.opencode', 'skills', 'flow-run', 'SKILL.md'), '\nmine\n');
  const res = require('node:child_process').spawnSync(process.execPath, [CLI, 'uninstall'], { cwd: dir, encoding: 'utf8' });
  assert.notEqual(res.status, 0);
  assert.match(res.stdout, /\.opencode\/skills\/flow-run\/SKILL\.md/);
  assert.ok(fs.existsSync(path.join(dir, '.opencode', 'plugins', 'coding-flow-guard.js')), 'a blocked uninstall unwires nothing');
});
