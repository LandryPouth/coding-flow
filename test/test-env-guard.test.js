"use strict";

// `npm test` runs as this repo's own `.githooks/pre-push` hook. Git sets
// GIT_DIR/GIT_WORK_TREE (and friends) in the environment of every hook it
// invokes; if that leaks into the suite, every fixture's `git init` in a
// fresh tmp directory silently resolves against the real repository instead
// (its git commands ignore `cwd` once GIT_DIR is set), landing bogus
// "commits" on whatever branch the real repo has checked out.
//
// This pins the fix (`scripts/test-env-guard.js`, preloaded via
// `node --require` in the `test` script): a real `execFileSync('git', ...)`
// call, in a real tmp directory, must stay isolated even when the calling
// process already has these variables set — the exact shape of running
// inside a git hook.
//
// Both tests below operate exclusively on throwaway tmp directories created
// for this run — never on this repository itself.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const GUARD = path.join(__dirname, '..', 'scripts', 'test-env-guard.js');
const POISONED_NAMES = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_COMMON_DIR',
  'GIT_CEILING_DIRECTORIES',
];

test('the guard deletes every git-hook environment variable it targets', () => {
  const env = Object.fromEntries(POISONED_NAMES.map((name) => [name, '/bogus/path']));
  const out = execFileSync(
    process.execPath,
    ['--require', GUARD, '-e', `console.log(JSON.stringify(${JSON.stringify(POISONED_NAMES)}.map((n) => n in process.env)))`],
    { env, encoding: 'utf8' },
  );

  assert.deepEqual(JSON.parse(out), POISONED_NAMES.map(() => false));
});

test('a poisoned GIT_DIR would otherwise hijack a fixture repo (negative control)', (t) => {
  // Without the guard, this is exactly what broke: a hook sets GIT_DIR (not
  // GIT_WORK_TREE) in its own process environment. With GIT_WORK_TREE unset
  // and the target non-bare, git falls back to `cwd` as the work tree — so a
  // fixture's `git init`/`git commit`, run with `cwd: <tmp dir>`, reads files
  // from that tmp dir but writes the commit into the *real* repository named
  // by the leaked GIT_DIR, moving its HEAD. Both "repos" here are disposable
  // tmp directories created for this test — this never touches the real
  // coding-flow repository.
  const realRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-envguard-real-'));
  t.after(() => fs.rmSync(realRepo, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: realRepo });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: realRepo });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: realRepo });
  execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: realRepo });
  fs.writeFileSync(path.join(realRepo, 'seed.txt'), 'seed\n');
  execFileSync('git', ['add', '-A'], { cwd: realRepo });
  execFileSync('git', ['commit', '-q', '-m', 'seed'], { cwd: realRepo });
  const before = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: realRepo, encoding: 'utf8' }).trim();

  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-envguard-fixture-'));
  t.after(() => fs.rmSync(fixtureDir, { recursive: true, force: true }));

  const poisonedEnv = { ...process.env, GIT_DIR: path.join(realRepo, '.git') };
  fs.writeFileSync(path.join(fixtureDir, 'fixture.txt'), 'fixture\n');
  execFileSync('git', ['add', '-A'], { cwd: fixtureDir, env: poisonedEnv });
  execFileSync('git', ['commit', '-q', '-m', 'fixture'], { cwd: fixtureDir, env: poisonedEnv });

  const after = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: realRepo, encoding: 'utf8' }).trim();
  assert.notEqual(after, before, 'the poisoned env must have moved the real repo — proving the hijack is real');
});
