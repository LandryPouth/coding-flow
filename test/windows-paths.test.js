'use strict';

// Story 29-05: what Windows does differently, pinned on every platform.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const { nativeShellPath } = require('../bin/lib/shell-writes');
const { killTree, descendantsOf, parseProcessList } = require('../bin/lib/validation-run');

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

const STARTED = 1_000_000;

test('a timed-out command on Windows kills only what it started, found by parent id and creation time', () => {
  const processes = [
    { pid: 50, parentPid: 4, created: 10 }, // the system, long before
    { pid: 200, parentPid: 100, created: STARTED + 5 }, // node, started by the dead cmd.exe 100
    { pid: 201, parentPid: 200, created: STARTED + 9 }, // what node started
    { pid: 300, parentPid: 100, created: STARTED - 60_000 }, // an orphan whose dead parent once had id 100
    { pid: 301, parentPid: 300, created: STARTED - 50_000 }, // and its child
    { pid: 400, parentPid: 201, created: STARTED + 1 }, // id 201's parent id, but created before 201: not its child
  ];
  assert.deepEqual(descendantsOf(processes, 100, STARTED), [200, 201]);
});

test('a live process now holding the dead shell id is not the shell: its children are not killed', () => {
  const processes = [
    { pid: 200, parentPid: 100, created: STARTED + 5 }, // the shell's own child, before the shell died
    { pid: 100, parentPid: 7, created: STARTED + 500 }, // a new process reusing id 100
    { pid: 210, parentPid: 100, created: STARTED + 600 }, // its child
  ];
  assert.deepEqual(descendantsOf(processes, 100, STARTED), [200]);
});

test('a reused-id cycle in the parent ids ends', () => {
  const processes = [
    { pid: 200, parentPid: 100, created: STARTED + 5 },
    { pid: 201, parentPid: 200, created: STARTED + 5 },
    { pid: 200, parentPid: 201, created: STARTED + 5 }, // 201 names 200, which names 201
    { pid: 202, parentPid: 201, created: STARTED + 5 },
  ];
  assert.deepEqual(descendantsOf(processes, 100, STARTED), [200, 201, 202]);
});

test('the process list is read from PowerShell lines; anything else is skipped', () => {
  assert.deepEqual(parseProcessList('200 100 1000005\r\n\r\nnoise\n201 200 1000009\n'), [
    { pid: 200, parentPid: 100, created: 1000005 },
    { pid: 201, parentPid: 200, created: 1000009 },
  ]);
  assert.deepEqual(parseProcessList(undefined), []);
});

test('on Windows the selected processes are killed by pid; elsewhere nothing runs', () => {
  const calls = [];
  const record = (command, args) => {
    calls.push([command, ...args]);
    return { stdout: `200 100 ${STARTED + 5}\n300 100 ${STARTED - 60000}\n` };
  };
  assert.deepEqual(killTree(100, STARTED, 'win32', record), [200]);
  assert.equal(calls[0][0], 'powershell.exe');
  assert.match(calls[0].at(-1), /Win32_Process/);
  assert.deepEqual(calls[1], ['taskkill', '/F', '/PID', '200']);

  calls.length = 0;
  assert.deepEqual(killTree(100, STARTED, 'linux', record), []);
  assert.deepEqual(killTree(undefined, STARTED, 'win32', record), []);
  assert.deepEqual(killTree(0, STARTED, 'win32', record), []);
  assert.deepEqual(calls, []);
});

test('a failing kill never throws: the timeout is still reported', () => {
  assert.deepEqual(killTree(100, STARTED, 'win32', () => { throw new Error('ENOENT'); }), []);
});

test('the destructive reader takes its platform from the host: a Git Bash cd is read on Windows only', () => {
  const { readDestructive } = require('../bin/lib/destructive');
  const command = 'cd /c/work && git push origin +main';
  const onWindows = readDestructive(command, { cwd: '/w', host: { home: () => '/home/u', platform: 'win32' } }).findings[0].cwd;
  const onLinux = readDestructive(command, { cwd: '/w', host: { home: () => '/home/u', platform: 'linux' } }).findings[0].cwd;
  assert.equal(onWindows, path.resolve('/w', 'C:/work'));
  assert.equal(onLinux, path.resolve('/w', '/c/work'));
  assert.notEqual(onWindows, onLinux);
});
