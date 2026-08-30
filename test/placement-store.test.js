'use strict';

// Unit tests for `withFileLock` (bin/lib/placement-store.js): the general
// exclusive filesystem lock story-03-02 extracted so `worktree.js` could
// reuse the same wait/steal-if-stale semantics to serialize `land` against
// the shared main checkout. The "wait for a live holder" branch is proven
// end-to-end against a real `land` in test/worktree.test.js ("worktree land
// waits for the shared land lock..."); this file proves the other branch
// directly — reclaiming a lock file abandoned by a crashed holder — which
// nothing in the suite exercised before, for either this primitive's
// original placement-JSON use (story-03-01) or its new, higher-stakes one
// (guarding real git mutations of the shared checkout, story-03-02).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const { withFileLock } = require('../bin/lib/placement-store');

function waitForFile(p, timeoutMs, message) {
  const deadline = Date.now() + timeoutMs;
  const buf = new Int32Array(new SharedArrayBuffer(4));
  while (!fs.existsSync(p)) {
    if (Date.now() > deadline) {
      assert.fail(message);
    }
    Atomics.wait(buf, 0, 0, 10);
  }
}

function freshLockPath(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-lock-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'test.lock');
}

test('withFileLock reclaims a lock file older than staleMs, left behind by a crashed holder', (t) => {
  const lockPath = freshLockPath(t);
  fs.writeFileSync(lockPath, '');
  const old = new Date(Date.now() - 1000);
  fs.utimesSync(lockPath, old, old);

  let ran = false;
  withFileLock(lockPath, () => {
    ran = true;
  }, { waitTimeoutMs: 500, staleMs: 100 });

  assert.ok(ran, 'the callback must run once the stale lock is reclaimed');
  assert.ok(!fs.existsSync(lockPath), 'the lock file must be released once the call finishes');
});

test('withFileLock does not reclaim a lock file younger than staleMs — it waits, then times out', (t) => {
  const lockPath = freshLockPath(t);
  fs.writeFileSync(lockPath, '');

  assert.throws(
    () => withFileLock(lockPath, () => {}, { waitTimeoutMs: 150, staleMs: 60 * 1000 }),
    /timed out waiting for the lock/,
    'a lock well within its stale window must not be stolen — it should time out instead',
  );

  fs.rmSync(lockPath, { force: true });
});

test('withFileLock releases the lock even when the callback throws, so a failed call does not block the next one', (t) => {
  const lockPath = freshLockPath(t);

  assert.throws(() => withFileLock(lockPath, () => {
    throw new Error('boom');
  }, { waitTimeoutMs: 500, staleMs: 60 * 1000 }), /boom/);

  assert.ok(!fs.existsSync(lockPath), 'a thrown callback must still release the lock');

  let ranSecond = false;
  withFileLock(lockPath, () => {
    ranSecond = true;
  }, { waitTimeoutMs: 500, staleMs: 60 * 1000 });
  assert.ok(ranSecond, 'a later call must be able to acquire the lock the failed call released');
});

test('withFileLock does not delete a lock stolen from it while it was still (slowly) running', (t) => {
  const lockPath = freshLockPath(t);
  const readyPath = `${lockPath}.ready`;
  const donePath = `${lockPath}.done`;
  const holdMs = 300;

  // A "legitimately still running" holder: acquires normally (no
  // contention), then backdates its OWN lock file past a short staleMs so a
  // later waiter treats it as abandoned, then keeps "working" (sleeping)
  // well past that point before its own release runs — reproducing the
  // window where a holder is stolen from while it is still alive, not
  // crashed.
  const holderPath = `${lockPath}.holder.js`;
  fs.writeFileSync(
    holderPath,
    [
      "const fs = require('fs');",
      `const { withFileLock } = require(${JSON.stringify(path.join(__dirname, '..', 'bin', 'lib', 'placement-store'))});`,
      `const lockPath = ${JSON.stringify(lockPath)};`,
      `const readyPath = ${JSON.stringify(readyPath)};`,
      `const donePath = ${JSON.stringify(donePath)};`,
      `const holdMs = ${holdMs};`,
      'withFileLock(lockPath, () => {',
      '  const old = new Date(Date.now() - 10000);',
      '  fs.utimesSync(lockPath, old, old);',
      "  fs.writeFileSync(readyPath, 'ready');",
      '  const buf = new Int32Array(new SharedArrayBuffer(4));',
      '  Atomics.wait(buf, 0, 0, holdMs);',
      '});',
      "fs.writeFileSync(donePath, 'done');",
    ].join('\n'),
  );

  const holder = spawn(process.execPath, [holderPath], { stdio: 'ignore' });
  t.after(() => {
    try {
      holder.kill();
    } catch {
      // already exited on its own — nothing to clean up.
    }
  });

  waitForFile(readyPath, 2000, 'the background holder never backdated its lock and signaled ready');

  // Steals the now-stale-looking lock while the background holder is still
  // asleep inside its own callback — the real "stolen while still alive"
  // race, not a contrived token comparison.
  let sawOwnTokenBeforeHolderReleased = null;
  withFileLock(
    lockPath,
    () => {
      const stolenContent = fs.readFileSync(lockPath, 'utf8');

      // Wait for the background holder to wake up and run its own release
      // logic — the exact moment a pre-fix `withFileLock` would delete
      // whatever is currently at `lockPath`, which by now is this call's
      // own lock, not the holder's.
      waitForFile(donePath, holdMs + 2000, 'the background holder never finished releasing');

      sawOwnTokenBeforeHolderReleased = fs.existsSync(lockPath) && fs.readFileSync(lockPath, 'utf8') === stolenContent;
    },
    { waitTimeoutMs: 2000, staleMs: 1000 },
  );

  assert.ok(
    sawOwnTokenBeforeHolderReleased,
    "the background holder's own release must not have deleted this call's lock after being stolen from",
  );
  assert.ok(!fs.existsSync(lockPath), 'this call must still release its own lock normally once its callback returns');
});
