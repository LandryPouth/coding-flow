'use strict';

// Story 29-05: what Windows does differently, pinned on every platform.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const { nativeShellPath } = require('../bin/lib/shell-writes');
const { killTree, descendantsOf, parseProcessList, runValidationCommand, CLOCK_TOLERANCE_MS } = require('../bin/lib/validation-run');

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
// When spawnSync returned: the shell was dead by then.
const ENDED = STARTED + 300;

test('a timed-out command on Windows kills only what it started, found by parent id and creation time', () => {
  const processes = [
    { pid: 50, parentPid: 4, created: 10 }, // the system, long before
    { pid: 200, parentPid: 100, created: STARTED + 5 }, // node, started by the dead cmd.exe 100
    { pid: 201, parentPid: 200, created: STARTED + 9 }, // what node started
    { pid: 300, parentPid: 100, created: STARTED - 60_000 }, // an orphan whose dead parent once had id 100
    { pid: 301, parentPid: 300, created: STARTED - 50_000 }, // and its child
    { pid: 400, parentPid: 201, created: STARTED + 1 }, // id 201's parent id, but created before 201: not its child
  ];
  assert.deepEqual(descendantsOf(processes, 100, STARTED, ENDED), [200, 201]);
});

test('a live process now holding the dead shell id is not the shell: its children are not killed', () => {
  const processes = [
    { pid: 200, parentPid: 100, created: STARTED + 5 }, // the shell's own child, before the shell died
    { pid: 100, parentPid: 7, created: STARTED + 500 }, // a new process reusing id 100
    { pid: 210, parentPid: 100, created: STARTED + 600 }, // its child
  ];
  assert.deepEqual(descendantsOf(processes, 100, STARTED, ENDED), [200]);
});

test('a process naming the dead shell as parent but created after the shell died is not its child, nor are its children', () => {
  // The shell dies at the timeout; an unrelated A reuses its id, starts B and
  // exits before the process list is read. A is not listed, so no impostor
  // bound applies: only "created before spawnSync returned" keeps B out.
  const processes = [
    { pid: 200, parentPid: 100, created: STARTED + 5 }, // the shell's own child
    { pid: 900, parentPid: 100, created: STARTED + 900 }, // B, child of the vanished A
    { pid: 901, parentPid: 900, created: STARTED + 950 }, // B's child
  ];
  assert.deepEqual(descendantsOf(processes, 100, STARTED, ENDED), [200]);
});

// Windows stamps a creation time once per timer tick (15.6 ms), rounded down;
// Date.now() is another clock. A real child can read a tick or two off.
const TICK = 16;

test('a shell child stamped a clock tick before the command started is still its child; one stamped beyond the tolerance is not', () => {
  assert.ok(CLOCK_TOLERANCE_MS >= 2 * TICK && CLOCK_TOLERANCE_MS <= 100, 'the tolerance is tick-sized: tens of ms');
  const processes = [
    { pid: 200, parentPid: 100, created: STARTED - TICK }, // the shell's child, read a tick early
    { pid: 201, parentPid: 200, created: STARTED - TICK }, // what it started in the same tick
    { pid: 202, parentPid: 100, created: STARTED - CLOCK_TOLERANCE_MS }, // at the edge: still in
    { pid: 300, parentPid: 100, created: STARTED - CLOCK_TOLERANCE_MS - 1 }, // beyond: an orphan of a former id 100
  ];
  assert.deepEqual(descendantsOf(processes, 100, STARTED, ENDED), [200, 202, 201]);
});

test('a shell child stamped a clock tick after spawnSync returned is still its child; one stamped beyond the tolerance is not', () => {
  const processes = [
    { pid: 200, parentPid: 100, created: ENDED + TICK }, // `b` in `a && b`, read a tick late
    { pid: 202, parentPid: 100, created: ENDED + CLOCK_TOLERANCE_MS }, // at the edge: still in
    { pid: 900, parentPid: 100, created: ENDED + CLOCK_TOLERANCE_MS + 1 }, // beyond: a later holder's child
    { pid: 901, parentPid: 900, created: ENDED + CLOCK_TOLERANCE_MS + 5 }, // and its child
  ];
  assert.deepEqual(descendantsOf(processes, 100, STARTED, ENDED), [200, 202]);
});

test('a live descendant may still start processes after the shell died: they are in the tree', () => {
  const processes = [
    { pid: 200, parentPid: 100, created: STARTED + 5 },
    { pid: 201, parentPid: 200, created: ENDED + 50 }, // started by node while the list was being read
  ];
  assert.deepEqual(descendantsOf(processes, 100, STARTED, ENDED), [200, 201]);
});

test('a reused-id cycle in the parent ids ends', () => {
  const processes = [
    { pid: 200, parentPid: 100, created: STARTED + 5 },
    { pid: 201, parentPid: 200, created: STARTED + 5 },
    { pid: 200, parentPid: 201, created: STARTED + 5 }, // 201 names 200, which names 201
    { pid: 202, parentPid: 201, created: STARTED + 5 },
  ];
  assert.deepEqual(descendantsOf(processes, 100, STARTED, ENDED), [200, 201, 202]);
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
  assert.deepEqual(killTree(100, STARTED, ENDED, 'win32', record), [200]);
  assert.equal(calls[0][0], 'powershell.exe');
  assert.match(calls[0].at(-1), /Win32_Process/);
  assert.match(calls[0].at(-1), /ToUniversalTime\(\)/, 'creation times are read in UTC');
  assert.deepEqual(calls[1], ['taskkill', '/F', '/PID', '200']);

  calls.length = 0;
  assert.deepEqual(killTree(100, STARTED, ENDED, 'linux', record), []);
  assert.deepEqual(killTree(undefined, STARTED, ENDED, 'win32', record), []);
  assert.deepEqual(killTree(0, STARTED, ENDED, 'win32', record), []);
  assert.deepEqual(calls, []);
});

test('what a killed process started between the listing and the kill is killed by a second pass', () => {
  const calls = [];
  const listings = [
    `200 100 ${STARTED + 5}\n`, // the first listing: the shell's child
    // The second: 200 is gone, but started 202 before it died, and 202 started
    // 210. 203 names 200 yet predates it: an orphan of a former id 200.
    `202 200 ${STARTED + 400}\n203 200 ${STARTED - 60000}\n210 202 ${STARTED + 410}\n`,
  ];
  const record = (command, args) => {
    calls.push([command, ...args]);
    return command === 'powershell.exe' ? { stdout: listings.shift() } : {};
  };
  assert.deepEqual(killTree(100, STARTED, ENDED, 'win32', record), [200, 202, 210]);
  assert.deepEqual(calls.map((call) => call[0]), ['powershell.exe', 'taskkill', 'powershell.exe', 'taskkill']);
  assert.deepEqual(calls[1], ['taskkill', '/F', '/PID', '200']);
  assert.deepEqual(calls[3], ['taskkill', '/F', '/PID', '202', '/PID', '210']);
});

test('the second pass spares a process that took a killed pid and what it started', () => {
  const calls = [];
  const killedAt = Date.now();
  const listings = [
    `200 100 ${STARTED + 5}\n`,
    // 200 was killed; a new process now holds id 200 and started 220.
    `200 7 ${killedAt + 1000}\n220 200 ${killedAt + 1100}\n`,
  ];
  const record = (command, args) => {
    calls.push([command, ...args]);
    return command === 'powershell.exe' ? { stdout: listings.shift() } : {};
  };
  assert.deepEqual(killTree(100, STARTED, ENDED, 'win32', record), [200]);
  assert.deepEqual(calls.map((call) => call[0]), ['powershell.exe', 'taskkill', 'powershell.exe']);
});

test('a failing kill never throws: the timeout is still reported', () => {
  assert.deepEqual(killTree(100, STARTED, ENDED, 'win32', () => { throw new Error('ENOENT'); }), []);
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

// The overflow path, observed through an injected kill: it runs on every
// platform (killTree itself does nothing outside Windows).
// The commands get no NODE_V8_COVERAGE: off Windows a timed-out node outlives
// its shell, and must not write coverage files into the suite's run after it.
const QUIET = Object.fromEntries(Object.entries(process.env).filter(([name]) => name !== 'NODE_V8_COVERAGE'));
test('a command whose output overflows has its tree killed, with the window it ran in', () => {
  const calls = [];
  const kill = (pid, started, ended) => { calls.push({ pid, started, ended }); return []; };
  const saved = process.env.CODING_FLOW_MAX_OUTPUT_BYTES;
  process.env.CODING_FLOW_MAX_OUTPUT_BYTES = '1024';
  try {
    const before = Date.now();
    const result = runValidationCommand(`node -e "process.stdout.write('x'.repeat(65536))"`, { kill, env: QUIET });
    const after = Date.now();
    assert.match(result.toolError, /output exceeded/);
    assert.equal(calls.length, 1, 'the overflowed command was not killed');
    assert.ok(Number.isInteger(calls[0].pid) && calls[0].pid > 0);
    assert.ok(before <= calls[0].started && calls[0].started <= calls[0].ended && calls[0].ended <= after);
  } finally {
    if (saved === undefined) delete process.env.CODING_FLOW_MAX_OUTPUT_BYTES;
    else process.env.CODING_FLOW_MAX_OUTPUT_BYTES = saved;
  }
});

test('a timed-out command has its tree killed; a command that ends is not', () => {
  const calls = [];
  const kill = (pid, started, ended) => { calls.push({ pid, started, ended }); return []; };
  const result = runValidationCommand(`node -e "setTimeout(()=>{},5000)"`, { timeoutMs: 300, kill, env: QUIET });
  assert.equal(result.timedOut, true);
  assert.equal(calls.length, 1);
  runValidationCommand(`node -e "0"`, { kill, env: QUIET });
  assert.equal(calls.length, 1, 'a command that ended on its own was killed');
});

test('the duration is the command\'s own: a slow kill is not counted in it', () => {
  const slowKill = () => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500); return []; };
  const result = runValidationCommand(`node -e "setTimeout(()=>{},5000)"`, { timeoutMs: 300, kill: slowKill, env: QUIET });
  assert.equal(result.timedOut, true);
  assert.ok(result.durationMs < 1500, `durationMs ${result.durationMs} counts the kill`);
});
