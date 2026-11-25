'use strict';

// Story 29-05: what Windows does differently, pinned on every platform.

const test = require('node:test');
const assert = require('node:assert');

const { nativeShellPath } = require('../bin/lib/shell-writes');
const { killTree } = require('../bin/lib/validation-run');

test('a Git Bash path is read as the Windows path it names, on Windows only', () => {
  for (const [word, windows] of [
    ['/c/Users/x/repo', 'C:/Users/x/repo'],
    ['/C/x', 'C:/x'],
    ['/d/a/b/', 'D:/a/b/'],
    ['/cygdrive/e/q', 'E:/q'],
    ['/c', 'C:/'],
    ['/c/', 'C:/'],
  ]) {
    assert.equal(nativeShellPath(word, 'win32'), windows, word);
    assert.equal(nativeShellPath(word, 'linux'), word, `${word} on Linux`);
    assert.equal(nativeShellPath(word, 'darwin'), word, `${word} on macOS`);
  }
});

test('anything that is not a drive in Git Bash form is left as written', () => {
  for (const word of ['/cc/x', '/tmp/x', '/usr/bin', 'c/x', 'C:/x', 'C:\\x', 'C:', './c/x', '~/x', '', '/']) {
    assert.equal(nativeShellPath(word, 'win32'), word, JSON.stringify(word));
  }
});

test('a timed-out command on Windows has its descendants killed by parent id; elsewhere nothing runs', () => {
  const calls = [];
  const record = (command, args) => calls.push([command, ...args]);
  assert.equal(killTree(4242, 'win32', record), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'powershell.exe');
  assert.match(calls[0].at(-1), /ParentProcessId=\$p/);
  assert.match(calls[0].at(-1), /Stop-Process/);
  assert.match(calls[0].at(-1), /K 4242$/);

  calls.length = 0;
  assert.equal(killTree(4242, 'linux', record), false);
  assert.equal(killTree(undefined, 'win32', record), false);
  assert.equal(killTree(0, 'win32', record), false);
  assert.deepEqual(calls, []);
});

test('a failing kill never throws: the timeout is still reported', () => {
  assert.equal(killTree(4242, 'win32', () => { throw new Error('ENOENT'); }), true);
});
