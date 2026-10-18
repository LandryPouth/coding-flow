'use strict';

// Platform detection: only a confirmed signal counts, everything else falls
// through to "unrecognized" instead of a guess.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { resolveTarget } = require('../bin/lib/detect');

function project(t, dirs = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-detect-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const name of dirs) fs.mkdirSync(path.join(dir, name));
  return dir;
}

test('an explicit --target beats the environment and existing directories', (t) => {
  const cwd = project(t, ['.claude']);
  const res = resolveTarget({ flags: { target: 'codex' }, env: { CLAUDECODE: '1' }, cwd });
  assert.deepEqual(res, { target: 'codex', source: 'flag' });
});

test('CLAUDECODE=1 beats an existing .codex directory', (t) => {
  const cwd = project(t, ['.codex']);
  const res = resolveTarget({ flags: {}, env: { CLAUDECODE: '1' }, cwd });
  assert.deepEqual(res, { target: 'claude', source: 'env:CLAUDECODE' });
});

test('an existing .codex or .claude directory names its platform when nothing else answers', (t) => {
  assert.equal(resolveTarget({ env: {}, cwd: project(t, ['.codex']) }).target, 'codex');
  assert.equal(resolveTarget({ env: {}, cwd: project(t, ['.claude']) }).target, 'claude');
});

test('a project carrying both directories resolves to claude, deterministically', (t) => {
  const both = resolveTarget({ env: {}, cwd: project(t, ['.claude', '.codex']) });
  assert.equal(both.target, 'claude');
  assert.equal(both.source, 'dir:.claude (also .codex)', 'the ambiguity is named in the source');
  assert.equal(resolveTarget({ env: {}, cwd: project(t, ['.claude']) }).source, 'dir:.claude');
});

test('no signal is "unrecognized" and never throws, even on a path that does not exist', (t) => {
  assert.deepEqual(resolveTarget({ env: {}, cwd: project(t) }), { target: 'unrecognized', source: 'none' });
  assert.equal(resolveTarget({ env: {}, cwd: path.join(os.tmpdir(), 'coding-flow-no-such-dir') }).target, 'unrecognized');
});

test('CLAUDECODE only counts when it is exactly "1", and an unknown flag value is ignored', (t) => {
  const cwd = project(t);
  assert.equal(resolveTarget({ env: { CLAUDECODE: 'true' }, cwd }).target, 'unrecognized');
  assert.equal(resolveTarget({ flags: { target: 'emacs' }, env: {}, cwd }).target, 'unrecognized');
});

test('OPENCODE=1 alone resolves to opencode', (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-detect-oc-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  assert.deepEqual(resolveTarget({ flags: {}, env: { OPENCODE: '1' }, cwd }), { target: 'opencode', source: 'env:OPENCODE' });
});

test('both CLAUDECODE=1 and OPENCODE=1 trust neither: one agent was launched from the other', (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-detect-both-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  assert.equal(resolveTarget({ flags: {}, env: { CLAUDECODE: '1', OPENCODE: '1' }, cwd }).target, 'unrecognized');
  fs.mkdirSync(path.join(cwd, '.claude'));
  assert.equal(resolveTarget({ flags: {}, env: { CLAUDECODE: '1', OPENCODE: '1' }, cwd }).source, 'dir:.claude');
});

test('both set: the agent nearer up the parent chain is the one that ran the command', (t) => {
  const cwd = project(t);
  const env = { CLAUDECODE: '1', OPENCODE: '1', CLAUDE_PID: '100', OPENCODE_PID: '200' };

  // OpenCode launched from Claude Code's terminal: OpenCode is the nearer parent.
  assert.deepEqual(resolveTarget({ env, cwd, ancestors: () => [300, 200, 150, 100] }), {
    target: 'opencode',
    source: 'env:OPENCODE (innermost of both)',
  });
  // The other way round.
  assert.equal(resolveTarget({ env, cwd, ancestors: () => [300, 100, 200] }).target, 'claude');
  // Neither id up the chain, or an id missing: still no guess.
  assert.equal(resolveTarget({ env, cwd, ancestors: () => [300, 400] }).target, 'unrecognized');
  assert.equal(resolveTarget({ env: { CLAUDECODE: '1', OPENCODE: '1', OPENCODE_PID: '200' }, cwd, ancestors: () => [200] }).target, 'unrecognized');
});

test('both set: init reads the real process chain', (t) => {
  const { spawnSync } = require('node:child_process');
  const cwd = project(t);
  const init = (env) =>
    spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'ai-flow.js'), 'init', '--dry-run'], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, CLAUDECODE: '1', OPENCODE: '1', ...env },
    }).stdout;

  // This test process is the child's parent, its own parent the grandparent.
  assert.match(init({ OPENCODE_PID: String(process.pid), CLAUDE_PID: String(process.ppid) }), /Skills \(opencode\)/);
  assert.doesNotMatch(init({ CLAUDE_PID: String(process.pid), OPENCODE_PID: String(process.ppid) }), /Skills \(opencode\)|Platform not recognized/);
});
