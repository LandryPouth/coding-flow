'use strict';

// Contract tests for `ai-flow hook` (proposal #3): an opt-in local pre-push gate
// that runs `audit --check` before a push. It must be idempotent, preserve a
// user's own hook, degrade cleanly when the CLI is unavailable, and actually block
// on a red/missing/stale proof while passing on a fresh green one. We test the file
// management AND execute the generated hook script for real.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');
const CLI_INVOCATION = `${process.execPath} ${CLI}`;

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `coding-flow-${prefix}-`));
}

function run(cwd, args) {
  try {
    const output = execFileSync(process.execPath, [CLI, ...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, output };
  } catch (err) {
    return { code: err.status ?? 1, output: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'ignore', 'ignore'] });
}

function gitRepo(t, prefix) {
  const dir = tmp(prefix);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  run(dir, ['init']);
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  return dir;
}

function hookPath(dir) {
  return path.join(dir, '.git', 'hooks', 'pre-push');
}

// Runs the installed hook the way git would, with a chosen CLI. Returns exit code.
function runHook(dir, cli) {
  try {
    execFileSync('sh', [hookPath(dir)], {
      cwd: dir,
      env: { ...process.env, CODING_FLOW_CLI: cli },
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    return 0;
  } catch (err) {
    return err.status ?? 1;
  }
}

test('install creates an executable pre-push hook carrying the managed block', (t) => {
  const dir = gitRepo(t, 'hook-install');
  const { code } = run(dir, ['hook', 'install']);
  assert.equal(code, 0);

  const p = hookPath(dir);
  assert.ok(fs.existsSync(p), 'the pre-push hook file exists');
  const content = fs.readFileSync(p, 'utf8');
  assert.match(content, /coding-flow \(managed\)/);
  assert.match(content, /audit --check/);
  assert.ok(fs.statSync(p).mode & 0o100, 'the hook is executable');
});

test('install is idempotent: a second run adds no duplicate block', (t) => {
  const dir = gitRepo(t, 'hook-idem');
  run(dir, ['hook', 'install']);
  const first = fs.readFileSync(hookPath(dir), 'utf8');
  const { output } = run(dir, ['hook', 'install']);
  const second = fs.readFileSync(hookPath(dir), 'utf8');

  assert.equal(first, second, 'the file is unchanged on re-install');
  assert.match(output, /already installed/i);
  assert.equal((second.match(/coding-flow \(managed\)/g) || []).length, 2, 'exactly one block (start+end markers)');
});

test("install preserves a user's existing pre-push hook", (t) => {
  const dir = gitRepo(t, 'hook-preserve');
  fs.mkdirSync(path.dirname(hookPath(dir)), { recursive: true });
  fs.writeFileSync(hookPath(dir), '#!/bin/sh\necho "my own hook"\n');

  run(dir, ['hook', 'install']);
  const content = fs.readFileSync(hookPath(dir), 'utf8');
  assert.match(content, /my own hook/, 'the user hook is kept');
  assert.match(content, /coding-flow \(managed\)/, 'our block is appended');
});

test('the installed hook blocks a push when the gate fails (no verify)', (t) => {
  const dir = gitRepo(t, 'hook-block');
  run(dir, ['hook', 'install']);
  // No verify recorded -> audit --check fails -> hook exits non-zero.
  assert.equal(runHook(dir, CLI_INVOCATION), 1);
});

test('the installed hook allows a push on a fresh green proof', (t) => {
  const dir = gitRepo(t, 'hook-pass');
  const storyRel = 'epics/epic-01-x/story-01-01-y';
  fs.mkdirSync(path.join(dir, storyRel), { recursive: true });
  fs.writeFileSync(path.join(dir, storyRel, 'story.md'), '# Story\n');
  const configPath = path.join(dir, '.coding-flow', 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.validation = { commands: ['node -e "process.exit(0)"'] };
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

  run(dir, ['hook', 'install']);
  run(dir, ['harness', 'verify', '--story', storyRel]);
  // Commit exactly the verified state so the proof stays fresh.
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'base']);

  assert.equal(runHook(dir, CLI_INVOCATION), 0, 'a fresh green proof lets the push through');
});

test('the installed hook degrades cleanly (exit 0) when the CLI cannot run', (t) => {
  const dir = gitRepo(t, 'hook-skip');
  run(dir, ['hook', 'install']);
  // `false version` fails the probe -> the hook skips instead of blocking.
  assert.equal(runHook(dir, 'false'), 0);
});

test('uninstall removes the block, deleting the file when only ours remains', (t) => {
  const dir = gitRepo(t, 'hook-uninstall');
  run(dir, ['hook', 'install']);
  assert.ok(fs.existsSync(hookPath(dir)));

  const { code } = run(dir, ['hook', 'uninstall']);
  assert.equal(code, 0);
  assert.ok(!fs.existsSync(hookPath(dir)), 'a hook that was only ours is removed entirely');
});

test('uninstall keeps a user hook, stripping only our block', (t) => {
  const dir = gitRepo(t, 'hook-uninstall-keep');
  fs.mkdirSync(path.dirname(hookPath(dir)), { recursive: true });
  fs.writeFileSync(hookPath(dir), '#!/bin/sh\necho "mine"\n');
  run(dir, ['hook', 'install']);
  run(dir, ['hook', 'uninstall']);

  const content = fs.readFileSync(hookPath(dir), 'utf8');
  assert.match(content, /mine/, 'user content survives');
  assert.doesNotMatch(content, /coding-flow \(managed\)/, 'our block is gone');
});

test('--dry-run writes nothing', (t) => {
  const dir = gitRepo(t, 'hook-dry');
  const { code, output } = run(dir, ['hook', 'install', '--dry-run']);
  assert.equal(code, 0);
  assert.match(output, /dry run/i);
  assert.ok(!fs.existsSync(hookPath(dir)), 'dry-run creates no file');
});

test('install fails cleanly outside a git work tree', (t) => {
  const dir = tmp('hook-nogit');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  run(dir, ['init']);
  const { code, output } = run(dir, ['hook', 'install']);
  assert.equal(code, 1);
  assert.match(output, /git/i);
});

test('status reports installed vs not installed', (t) => {
  const dir = gitRepo(t, 'hook-status');
  assert.match(run(dir, ['hook', 'status']).output, /not installed/i);
  run(dir, ['hook', 'install']);
  assert.match(run(dir, ['hook', 'status']).output, /installed/i);
});
