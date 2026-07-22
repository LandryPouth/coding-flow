'use strict';

// Tests du canal plugin : les skills du plugin restent en phase avec les
// templates (garde-fou anti-dérive), et les manifestes plugin/marketplace/hooks
// sont valides et synchronisés en version avec package.json.

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

test('plugin check confirme la parité skills/ ↔ templates', () => {
  // Exécuté dans le repo réel : ne doit jamais être en dérive une fois committé.
  const out = execFileSync(process.execPath, [CLI, 'plugin', 'check'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.match(out, /in sync/i);
});

test('plugin.json est un manifeste valide et synchronisé en version', () => {
  const plugin = readJson('.claude-plugin/plugin.json');
  const pkg = readJson('package.json');

  assert.match(plugin.name, /^[a-z0-9]+(-[a-z0-9]+)*$/, 'name en kebab-case');
  assert.match(plugin.version, /^\d+\.\d+\.\d+$/, 'version semver');
  assert.equal(plugin.version, pkg.version, 'plugin.json suit la version de package.json');
  assert.ok(plugin.description && plugin.description.length > 0);

  // Le chemin hooks doit pointer vers un fichier réel.
  const hooksRel = plugin.hooks.replace(/^\.\//, '');
  assert.ok(fs.existsSync(path.join(ROOT, hooksRel)), 'le fichier hooks référencé existe');
});

test('hooks.json câble le guard PreToolUse sur les outils d’écriture', () => {
  const hooks = readJson('.claude-plugin/hooks/hooks.json');
  assert.ok(Array.isArray(hooks.PreToolUse) && hooks.PreToolUse.length >= 1);
  const entry = hooks.PreToolUse[0];
  assert.match(entry.matcher, /Write/);
  assert.match(entry.hooks[0].command, /guard/);
});

test('marketplace.json liste le plugin avec une source et une version cohérentes', () => {
  const market = readJson('.claude-plugin/marketplace.json');
  const pkg = readJson('package.json');

  assert.ok(Array.isArray(market.plugins) && market.plugins.length >= 1);
  const entry = market.plugins.find((p) => p.name === 'coding-flow');
  assert.ok(entry, 'le plugin coding-flow est listé');
  assert.ok(entry.source, 'une source est fournie');
  assert.equal(entry.version, pkg.version, 'la version marketplace suit package.json');
});
