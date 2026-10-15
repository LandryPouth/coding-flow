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
  assert.equal(resolveTarget({ env: {}, cwd: project(t, ['.claude', '.codex']) }).target, 'claude');
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
