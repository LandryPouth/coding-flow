'use strict';

// In this package's own checkout the guard resolves bin/ai-flow.js relative to
// the project, so the tracked files carry no maintainer home path and a guard
// change is live in every clone. Any other project keeps the absolute path.

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { pluginSource } = require('../bin/lib/opencode');
const { guardCommandString } = require('../bin/lib/settings');

test('the plugin generated for this checkout resolves the binary relative to itself', () => {
  const src = pluginSource({ self: true });
  assert.match(src, /const BINARY = fileURLToPath\(new URL\("\.\.\/\.\.\/bin\/ai-flow\.js", import\.meta\.url\)\)/);
  assert.match(src, /import \{ fileURLToPath \} from "node:url"/);
  assert.doesNotMatch(src, /\/home\/|\/Users\//);
});

test('any other project keeps the absolute binary and the pinned fallback', () => {
  const src = pluginSource();
  assert.match(src, /const BINARY = "\//);
  assert.doesNotMatch(src, /fileURLToPath/);
});

test('init --opencode in a throwaway project writes the absolute path, not the relative one', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-selfinstall-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const res = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'ai-flow.js'), 'init', '--opencode'], { cwd: dir, encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  const plugin = fs.readFileSync(path.join(dir, '.opencode', 'plugins', 'coding-flow-guard.js'), 'utf8');
  assert.match(plugin, new RegExp(`const BINARY = ${JSON.stringify(path.join(ROOT, 'bin', 'ai-flow.js')).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.doesNotMatch(plugin, /import\.meta\.url\)\)/);
});

test('the tracked plugin and settings of this repository carry no home path', () => {
  for (const file of ['.opencode/plugins/coding-flow-guard.js', '.claude/settings.json']) {
    assert.doesNotMatch(fs.readFileSync(path.join(ROOT, file), 'utf8'), /\/home\/|\/Users\//, file);
  }
});

test('the tracked plugin is exactly what this checkout would generate', () => {
  assert.equal(fs.readFileSync(path.join(ROOT, '.opencode/plugins/coding-flow-guard.js'), 'utf8'), pluginSource({ self: true }));
});

test('the Claude hook for this checkout uses $CLAUDE_PROJECT_DIR', () => {
  const cmd = guardCommandString(ROOT);
  assert.match(cmd, /\$CLAUDE_PROJECT_DIR\/bin\/ai-flow\.js/);
  assert.doesNotMatch(cmd, /\/home\//);
  assert.match(guardCommandString(os.tmpdir()), /^R='\//);
});
