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

const { withFileLock } = require('../bin/lib/placement-store');

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
