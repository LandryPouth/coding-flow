'use strict';

// Two spellings of one directory (a Windows 8.3 short name next to git's long
// one, a macOS /var symlink) must not turn `../repo-worktrees/x` into a climb to
// the users directory and back. A symlink stands in for the short name here.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { relativePath } = require('../bin/lib/util');

test('relativePath reads through a second spelling of the same directory', (t) => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-relpath-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  fs.mkdirSync(path.join(base, 'real', 'repo'), { recursive: true });
  fs.mkdirSync(path.join(base, 'real', 'repo-worktrees', 'story-01-01-a'), { recursive: true });
  // A junction needs no admin right on Windows; a 'dir' symlink does.
  fs.symlinkSync(path.join(base, 'real'), path.join(base, 'alias'), process.platform === 'win32' ? 'junction' : 'dir');

  const cwd = path.join(base, 'alias', 'repo');
  const worktree = path.join(base, 'real', 'repo-worktrees', 'story-01-01-a');

  assert.equal(relativePath(cwd, worktree), '../repo-worktrees/story-01-01-a');
  assert.equal(relativePath(cwd, path.join(base, 'real', 'repo')), '.');
});
