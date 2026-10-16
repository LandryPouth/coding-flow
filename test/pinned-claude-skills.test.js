'use strict';

// The project copy of the Claude skills was the one copy left unpinned: its
// `npx @landry_pouth/coding-flow` ran whatever npm called latest, not the release
// that installed it. OpenCode reads .claude/skills too, so a real /flow-run in
// OpenCode ran an older `verify` than the project's. These pin the pin, and that
// an unpinned copy from an earlier release is refreshed, not reported as edited.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');
const { version, name } = require('../package.json');
const TEMPLATE = path.join(__dirname, '..', 'templates', '.claude', 'skills', 'flow-run', 'SKILL.md');
const REL = '.claude/skills/flow-run/SKILL.md';

function project(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-pinned-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const env = { ...process.env, CLAUDE_CONFIG_DIR: path.join(dir, '.no-claude-config'), CLAUDE_PLUGIN_ROOT: '' };
  delete env.CLAUDECODE;
  delete env.OPENCODE;
  const run = (args) => execFileSync(process.execPath, [CLI, ...args], { cwd: dir, env, encoding: 'utf8' });
  return { dir, run };
}

test('the project copy of the Claude skills pins npx to the installing release', (t) => {
  const { dir, run } = project(t);
  run(['init', '--target', 'claude', '--with-skills']);
  const skill = fs.readFileSync(path.join(dir, REL), 'utf8');
  assert.ok(skill.includes(`npx ${name}@${version} `), 'npx is pinned');
  assert.doesNotMatch(skill, new RegExp(`npx ${name.replace(/[/@.]/g, '\\$&')} `), 'no bare npx is left');
  assert.match(run(['upgrade']), /Updated: 0/);
});

test('an unpinned copy from an earlier release is refreshed by upgrade', (t) => {
  const { dir, run } = project(t);
  run(['init', '--target', 'claude', '--with-skills']);
  const raw = fs.readFileSync(TEMPLATE, 'utf8');
  fs.writeFileSync(path.join(dir, REL), raw);
  const manifestFile = path.join(dir, '.coding-flow', 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  manifest.files[REL] = { ...manifest.files[REL], hash: crypto.createHash('sha256').update(raw).digest('hex') };
  fs.writeFileSync(manifestFile, JSON.stringify(manifest));

  const out = run(['upgrade']);
  assert.doesNotMatch(out, /Skipped modified files/);
  assert.ok(fs.readFileSync(path.join(dir, REL), 'utf8').includes(`npx ${name}@${version} `));
});
