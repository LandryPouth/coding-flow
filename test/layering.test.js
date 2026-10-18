'use strict';

// The core/layer boundary (epic 12, Decisions) as a checked fact: the guard and
// the proof engine must keep working in a repository with no stories, epics,
// worktrees or skills, so no core module may `require` a layer module — directly
// or through another module. Where a core module needs story data, the layer
// passes it in as an argument.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const LIB = path.join(__dirname, '..', 'bin', 'lib');

const CORE = [
  'audit', 'config', 'context', 'coverage', 'coverage-gate', 'detect', 'diff-base',
  'diff-scope', 'evidence', 'guard', 'harness', 'harness-config', 'harness-report',
  'identity', 'policy', 'policy-fingerprint', 'report', 'risk', 'security-policy',
  'story', 'util', 'validation-run',
];

// `story` is core: a pure fs/path reader of the optional story files, used only
// when verify is given a story. `doctor` is a layer for now: it mixes the core
// checks with install diagnostics (templates, storage, platforms) that need
// splitting out before it can be called core.
const LAYER = [
  'doctor', 'backbone', 'claude-plugin', 'next', 'placement-store', 'plugin', 'review', 'run',
  'ship', 'skills', 'speckit', 'status', 'templates', 'worktree',
  'worktree-plan',
  // install, platform wiring and CLI plumbing: not needed to guard or prove
  'bootstrap', 'ci', 'codex-probe', 'codex-settings', 'commands', 'hook',
  'opencode', 'opencode-config', 'settings', 'trace', 'uninstall', 'unwire',
  'platforms/*', 'storage/*',
];

function modules() {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) {
        out.push(path.relative(LIB, full).replace(/\.js$/, '').split(path.sep).join('/'));
      }
    }
  };
  walk(LIB);
  return out.sort();
}

function listed(name, list) {
  return list.some((item) => (item.endsWith('/*') ? name.startsWith(item.slice(0, -1)) : item === name));
}

// Static `require("./x")` / `require("../x")` calls, resolved to module names
// relative to bin/lib. Anything that leaves bin/lib (package.json) is ignored.
function requiresOf(name) {
  const file = path.join(LIB, `${name}.js`);
  // Comments are stripped so a `require("./x")` in prose is not a dependency.
  const source = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const found = [];
  for (const match of source.matchAll(/require\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g)) {
    let target = path.resolve(path.dirname(file), match[1]);
    if (fs.existsSync(`${target}.js`)) target += '.js';
    else if (fs.existsSync(path.join(target, 'index.js'))) target = path.join(target, 'index.js');
    else continue;
    const rel = path.relative(LIB, target);
    if (rel.startsWith('..')) continue;
    found.push(rel.replace(/\.js$/, '').replace(/\/index$/, '/index').split(path.sep).join('/'));
  }
  return found;
}

test('every module under bin/lib is classified as core or layer', () => {
  const unclassified = modules().filter((m) => !listed(m, CORE) && !listed(m, LAYER));
  assert.deepStrictEqual(
    unclassified,
    [],
    `classify this module as core or layer in test/layering.test.js: ${unclassified.join(', ')}`,
  );
  const both = modules().filter((m) => listed(m, CORE) && listed(m, LAYER));
  assert.deepStrictEqual(both, [], `module listed as both core and layer: ${both.join(', ')}`);
});

test('every listed module exists', () => {
  const present = new Set(modules());
  const missing = [...CORE, ...LAYER].filter(
    (item) => !(item.endsWith('/*') ? [...present].some((m) => m.startsWith(item.slice(0, -1))) : present.has(item)),
  );
  assert.deepStrictEqual(missing, [], `listed but not found under bin/lib: ${missing.join(', ')}`);
});

test('no core module requires a layer module, directly or transitively', () => {
  const violations = [];
  for (const start of CORE) {
    const seen = new Set([start]);
    const queue = [[start]];
    while (queue.length) {
      const chain = queue.shift();
      for (const next of requiresOf(chain[chain.length - 1])) {
        if (listed(next, LAYER)) {
          violations.push([...chain, next].join(' → '));
          continue;
        }
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push([...chain, next]);
      }
    }
  }
  assert.deepStrictEqual(violations, [], `core must not depend on a layer:\n  ${violations.join('\n  ')}`);
});
