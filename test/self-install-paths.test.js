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
const { pathToFileURL } = require('node:url');
// `module.register` exists from Node 18.19 / 20.6; an older Node skips the loader test, saying why.
const { register } = require('node:module');
const NO_REGISTER = typeof register !== 'function' && `module.register is missing from Node ${process.version} (it needs 18.19 or 20.6+)`;

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
  assert.match(src, /const BINARY = "(\/|[A-Za-z]:\\\\)/);
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

// The tracked copy itself, loaded as OpenCode loads it: it runs this checkout's
// guard in-process and passes on the guard's own unchecked line, next step included.
test('the tracked plugin tells the agent to ask the human about a command it could not prove', { skip: NO_REGISTER }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-selfinstall-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const init = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'ai-flow.js'), 'init'], { cwd: dir, encoding: 'utf8' });
  assert.equal(init.status, 0, init.stderr);
  // This package is CommonJS and OpenCode's own `.opencode/package.json` is not
  // tracked, so the import is told what OpenCode knows: the plugin is an ES module.
  register(`data:text/javascript,${encodeURIComponent(
    'export async function load(url, context, next) {'
    + ' return url.endsWith("/.opencode/plugins/coding-flow-guard.js") ? next(url, { ...context, format: "module" }) : next(url, context); }',
  )}`);
  const mod = await import(pathToFileURL(path.join(ROOT, '.opencode', 'plugins', 'coding-flow-guard.js')).href);
  const before = (await mod.default.server({ directory: dir }))['tool.execute.before'];
  const lines = [];
  const original = process.stderr.write;
  process.stderr.write = (chunk) => {
    lines.push(String(chunk));
    return true;
  };
  try {
    await before({ tool: 'bash' }, { args: { command: `python3 -c 'import os; os.system("rm -rf build")'` } });
  } finally {
    process.stderr.write = original;
  }
  assert.match(lines.join(''), /read inside code \(an interpreter string: `rm -rf build`, [^)]*\); this write was NOT checked — ask the human before running it/);
});

test('the Claude hook for this checkout uses $CLAUDE_PROJECT_DIR', { skip: process.platform === 'win32' && 'the wired Claude hook is a POSIX sh command' }, () => {
  const cmd = guardCommandString(ROOT);
  assert.match(cmd, /\$CLAUDE_PROJECT_DIR\/bin\/ai-flow\.js/);
  assert.doesNotMatch(cmd, /\/home\//);
  assert.match(guardCommandString(os.tmpdir()), /^R='\//);
});
