'use strict';

// Contract tests for scripts/check-lock-exit-reachability.js (story-04-03): a
// deterministic check for the exact bug class story-03-02's sixth
// /flow-review pass found by hand — a callback passed to this project's
// `withFileLock(...)` helper that calls a same-file helper function whose
// body reaches `git()` without `{ allowFail: true }`, leaking the lock when
// that call fails (`fail()` -> `process.exit()` runs before `withFileLock`'s
// own `finally`).

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const { checkText, checkFile } = require('../scripts/check-lock-exit-reachability');

// Reproduces landCleanup's pre-fix shape exactly (see commit e771312's diff):
// two unguarded `git()` calls reachable from a helper the withFileLock
// callback invokes.
const PRE_FIX_LAND_CLEANUP = `
"use strict";
function git(cwd, gitArgs, { allowFail = false } = {}) {
  return { code: 0 };
}
function landCleanup(root, match, branch, found) {
  git(root, ["worktree", "remove", match.path]);
  git(root, ["worktree", "prune"]);
  if (branch) {
    git(root, ["branch", "-D", branch], { allowFail: true });
  }
}
function worktreeLand() {
  withFileLock(lockPath, () => {
    landCleanup(root, match, branch, found);
  }, opts);
}
`;

// The current, fixed shape: every mutating call converted to
// { allowFail: true } + an explicit throw.
const POST_FIX_LAND_CLEANUP = `
"use strict";
function git(cwd, gitArgs, { allowFail = false } = {}) {
  return { code: 0 };
}
function landCleanup(root, match, branch, found) {
  const remove = git(root, ["worktree", "remove", match.path], { allowFail: true });
  if (remove.code !== 0) {
    throw new Error("removing worktree failed");
  }
  const prune = git(root, ["worktree", "prune"], { allowFail: true });
  if (prune.code !== 0) {
    throw new Error("prune failed");
  }
  if (branch) {
    git(root, ["branch", "-D", branch], { allowFail: true });
  }
}
function worktreeLand() {
  withFileLock(lockPath, () => {
    landCleanup(root, match, branch, found);
  }, opts);
}
`;

test('flags the pre-fix landCleanup shape: an unguarded git() call reachable from a withFileLock callback', () => {
  const findings = checkText('fixture.js', PRE_FIX_LAND_CLEANUP);
  assert.ok(findings.length > 0, 'the pre-fix shape must be flagged');
  assert.equal(findings[0].helper, 'landCleanup');
  assert.match(findings[0].text, /worktree.*remove/);
});

test('passes clean on the fixed landCleanup shape: every mutating call is allowFail-guarded', () => {
  const findings = checkText('fixture.js', POST_FIX_LAND_CLEANUP);
  assert.deepEqual(findings, [], `expected no findings, got: ${JSON.stringify(findings)}`);
});

test('a comment mentioning git()/landCleanup by name inside the callback does not create a false positive', () => {
  const text = `
"use strict";
function git(cwd, gitArgs, { allowFail = false } = {}) {
  return { code: 0 };
}
function landCleanup(root) {
  // this comment mentions git() and landCleanup but calls neither unguarded
  const r = git(root, ["worktree", "remove", root], { allowFail: true });
  if (r.code !== 0) throw new Error("x");
}
function worktreeLand() {
  withFileLock(lockPath, () => {
    // landCleanup(root) is only mentioned here in prose, not called
    landCleanup(root);
  }, opts);
}
`;
  const findings = checkText('fixture.js', text);
  assert.deepEqual(findings, []);
});

test('a file with no withFileLock call is skipped entirely, even if it defines a similarly-shaped helper', () => {
  const text = `
function git(cwd, gitArgs) { return { code: 0 }; }
function landCleanup(root) {
  git(root, ["worktree", "remove", root]);
}
`;
  assert.deepEqual(checkText('fixture.js', text), []);
});

test('a regex literal ending in two adjacent slashes on the same line as an unguarded call does not hide that call', () => {
  // Mirrors bin/lib/ship.js's real `/^ssh:\/\/git@github\.com\//i` pattern: the
  // escaped-slash-then-closing-delimiter tail reads as "//" if the scanner
  // isn't regex-aware, which used to blank the rest of the line as a comment —
  // silently erasing the unguarded git() call that follows on the same line.
  const text = `
"use strict";
function git(cwd, gitArgs, { allowFail = false } = {}) {
  return { code: 0 };
}
function landCleanup(root) {
  const re = /^ssh:\\/\\/git@github\\.com\\//i; git(root, ["worktree", "remove", root]);
}
function worktreeLand() {
  withFileLock(lockPath, () => {
    landCleanup(root);
  }, opts);
}
`;
  const findings = checkText('fixture.js', text);
  assert.ok(findings.length > 0, 'the unguarded call after the regex literal must still be flagged');
  assert.match(findings[0].text, /worktree.*remove/);
});

test('the real, current worktree.js passes clean (no false positive on the converted calls)', () => {
  const findings = checkFile(path.posix.join('bin', 'lib', 'worktree.js'));
  assert.deepEqual(findings, [], `expected no findings on the real, fixed worktree.js, got: ${JSON.stringify(findings)}`);
});
