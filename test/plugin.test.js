'use strict';

// Tests of the plugin channel: the plugin's skills stay in sync with the
// templates (anti-drift guardrail), and the plugin/marketplace/hooks manifests
// are valid and version-synced with package.json.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'ai-flow.js');

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

test('plugin check confirms skills/ <-> templates parity', () => {
  // Run in the real repo: it must never be out of sync once committed.
  const out = execFileSync(process.execPath, [CLI, 'plugin', 'check'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.match(out, /in sync/i);
});

test('plugin.json is a valid manifest, version-synced', () => {
  const plugin = readJson('.claude-plugin/plugin.json');
  const pkg = readJson('package.json');

  assert.match(plugin.name, /^[a-z0-9]+(-[a-z0-9]+)*$/, 'name in kebab-case');
  assert.match(plugin.version, /^\d+\.\d+\.\d+$/, 'semver version');
  assert.equal(plugin.version, pkg.version, 'plugin.json follows the package.json version');
  assert.ok(plugin.description && plugin.description.length > 0);

  // The hooks path must point to a real file.
  const hooksRel = plugin.hooks.replace(/^\.\//, '');
  assert.ok(fs.existsSync(path.join(ROOT, hooksRel)), 'the referenced hooks file exists');
});

test('hooks.json wires the guard PreToolUse on the write tools', () => {
  const hooks = readJson('.claude-plugin/hooks/hooks.json');
  // Plugin hooks nest the event map under a required top-level "hooks" key.
  assert.ok(hooks.hooks && typeof hooks.hooks === 'object', 'events are nested under "hooks"');
  assert.ok(Array.isArray(hooks.hooks.PreToolUse) && hooks.hooks.PreToolUse.length >= 1);
  const entry = hooks.hooks.PreToolUse[0];
  assert.match(entry.matcher, /Write/);
  assert.match(entry.hooks[0].command, /guard/);
});

test('marketplace.json lists the plugin with a consistent source and version', () => {
  const market = readJson('.claude-plugin/marketplace.json');
  const pkg = readJson('package.json');

  assert.ok(Array.isArray(market.plugins) && market.plugins.length >= 1);
  const entry = market.plugins.find((p) => p.name === 'coding-flow');
  assert.ok(entry, 'the coding-flow plugin is listed');
  assert.ok(entry.source, 'a source is provided');
  assert.equal(entry.version, pkg.version, 'the marketplace version follows package.json');
});
