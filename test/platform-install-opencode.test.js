'use strict';

const { defineSuite } = require('../test-support/commands-only-suite');

defineSuite({
  target: 'opencode',
  files: (name) => `.opencode/command/${name}.md`,
  parser: 'yaml',
  describe: (parsed) => parsed.description,
});

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');

function initOpenCode(t, extra) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-oc-msg-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const run = (args) => execFileSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return { out: run(['init', '--target', 'opencode', ...extra]), doctor: run(['doctor']) };
}

test('opencode: with --opencode the init and doctor never claim there is no guard', (t) => {
  const { out, doctor } = initOpenCode(t, ['--opencode']);
  assert.match(out, /Guard plugin \(OpenCode\): wired/);
  assert.doesNotMatch(out, /Guard hook: none/);
  assert.doesNotMatch(doctor, /guard not available/);
});

test('opencode: without --opencode the install says how to get a guard', (t) => {
  const { out, doctor } = initOpenCode(t, []);
  assert.match(out, /Re-run with --opencode/);
  assert.match(doctor, /guard not available on this host \(opencode\).*--opencode/);
});
