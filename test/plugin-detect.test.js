'use strict';

// Detection of an installed coding-flow plugin.
//
// This decides whether `init` copies the skills into the project, so a WRONG
// answer is not cosmetic:
//   - false negative -> the project copies skills the plugin also serves:
//     two names for one skill (annoying, recoverable, the historical behavior).
//   - false positive -> the project copies nothing while nothing serves them:
//     the user ends up with NO skills at all (the bad one).
//
// So the rule these tests pin down is: believe a plugin is installed only when
// the skills it would serve are visible ON DISK. A name in a registry, or a
// directory left behind by an uninstall, is a claim — not evidence.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DETECT = path.join(__dirname, '..', 'bin', 'lib', 'claude-plugin.js');

function claudeDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-detect-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'plugins'), { recursive: true });
  return dir;
}

// Detection runs in a child process so an unexpected crash surfaces as a failed
// test instead of taking the whole runner down with it.
function detect(claudeConfigDir, pluginRoot = '') {
  const output = execFileSync(
    process.execPath,
    ['-e', `console.log(JSON.stringify(require(${JSON.stringify(DETECT)}).detectPlugin()))`],
    {
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_CONFIG_DIR: claudeConfigDir, CLAUDE_PLUGIN_ROOT: pluginRoot },
    },
  );
  return JSON.parse(output);
}

function writeRegistry(dir, plugins) {
  fs.writeFileSync(
    path.join(dir, 'plugins', 'installed_plugins.json'),
    JSON.stringify({ version: 2, plugins }),
  );
}

// A plugin install that can really serve skills.
function installPlugin(dir, { marketplace = 'coding-flow', name = 'coding-flow', version = '9.9.9' } = {}) {
  const root = path.join(dir, 'plugins', 'cache', marketplace, name, version);
  fs.mkdirSync(path.join(root, 'skills', 'flow-run'), { recursive: true });
  fs.writeFileSync(path.join(root, 'skills', 'flow-run', 'SKILL.md'), '---\nname: flow-run\n---\n');
  fs.mkdirSync(path.join(root, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({ name, version }));
  return root;
}

test('a healthy install is detected', (t) => {
  const dir = claudeDir(t);
  const root = installPlugin(dir);
  writeRegistry(dir, { 'coding-flow@coding-flow': [{ installPath: root }] });

  assert.equal(detect(dir).installed, true);
});

test('a healthy install is detected from the cache alone, with no registry', (t) => {
  const dir = claudeDir(t);
  installPlugin(dir);

  const result = detect(dir);
  assert.equal(result.installed, true);
  assert.equal(result.source, 'cache');
});

test('CLAUDE_PLUGIN_ROOT detects the plugin we are running from', (t) => {
  const dir = claudeDir(t);
  const root = installPlugin(dir);

  const result = detect(dir, root);
  assert.equal(result.installed, true);
  assert.equal(result.source, 'env');
});

// --- Everything below must answer "not installed" -------------------------

test('a corrupt registry does not crash and does not claim an install', (t) => {
  const dir = claudeDir(t);
  fs.writeFileSync(path.join(dir, 'plugins', 'installed_plugins.json'), '{"plugins": {"coding-flo');

  assert.equal(detect(dir).installed, false, 'unreadable config means unknown, and unknown copies the skills');
});

test('a registry in an unknown shape does not claim an install', (t) => {
  const dir = claudeDir(t);
  // A future Claude Code format we do not understand.
  writeRegistry(dir, 'coding-flow@coding-flow');

  assert.equal(detect(dir).installed, false);
});

test('a registry entry whose install directory is gone is ignored', (t) => {
  const dir = claudeDir(t);
  writeRegistry(dir, { 'coding-flow@coding-flow': [{ installPath: path.join(dir, 'removed-by-hand') }] });

  assert.equal(detect(dir).installed, false, 'a stale entry must not cost the user their skills');
});

test('a registry entry pointing at a directory that serves no skill is ignored', (t) => {
  const dir = claudeDir(t);
  const half = path.join(dir, 'plugins', 'cache', 'coding-flow', 'coding-flow', '9.9.9');
  fs.mkdirSync(half, { recursive: true });
  writeRegistry(dir, { 'coding-flow@coding-flow': [{ installPath: half }] });

  assert.equal(detect(dir).installed, false, 'an interrupted install serves nothing');
});

test('an empty cache directory left behind by an uninstall is ignored', (t) => {
  const dir = claudeDir(t);
  fs.mkdirSync(path.join(dir, 'plugins', 'cache', 'coding-flow', 'coding-flow'), { recursive: true });

  assert.equal(detect(dir).installed, false, 'the name is not the artifact');
});

test('another plugin under a marketplace named coding-flow is not us', (t) => {
  const dir = claudeDir(t);
  installPlugin(dir, { marketplace: 'coding-flow', name: 'some-other-plugin' });

  assert.equal(detect(dir).installed, false);
});

test('CLAUDE_PLUGIN_ROOT pointing at another plugin is not us', (t) => {
  const dir = claudeDir(t);
  const other = installPlugin(dir, { marketplace: 'coding-flow', name: 'some-other-plugin' });

  assert.equal(detect(dir, other).installed, false, 'identity comes from the manifest, not the path');
});

test('CLAUDE_PLUGIN_ROOT pointing nowhere is ignored', (t) => {
  const dir = claudeDir(t);

  assert.equal(detect(dir, path.join(dir, 'does-not-exist')).installed, false);
});

test('an unreadable plugins directory does not crash', (t) => {
  const dir = claudeDir(t);
  const cache = path.join(dir, 'plugins', 'cache');
  fs.mkdirSync(cache, { recursive: true });
  fs.chmodSync(cache, 0o000);

  let result;
  try {
    result = detect(dir);
  } finally {
    // Restore before the temp-dir cleanup hook runs, not after it.
    fs.chmodSync(cache, 0o755);
  }

  // Running as root defeats the permission bit; the assertion still holds.
  assert.equal(result.installed, false);
});

test('no Claude Code config at all means no plugin', (t) => {
  const dir = claudeDir(t);
  fs.rmSync(path.join(dir, 'plugins'), { recursive: true, force: true });

  assert.equal(detect(dir).installed, false);
});
