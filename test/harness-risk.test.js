'use strict';

// Contract tests for story-04-03's structural risk signal: scoreDiffRisk
// (bin/lib/harness.js) escalates a diff that adds an unconditional
// git-mutation call (deletes a worktree, force-deletes a branch, merges/resets
// unattended) to at least `medium` risk — the same STRICT territory epic-03's
// own rationale already names as risky, even when nothing in the diff spells
// "auth"/"payment"/"migration". Real temp git repos throughout, matching this
// suite's own convention (e.g. test/next.test.js), since the signal reads a
// real `git diff`, not a fabricated file list.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { scoreDiffRisk, readHarnessConfig, changedFilesForCoverage } = require('../bin/lib/harness');

function sh(cwd, cmd, args) {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function initRepo(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-harness-risk-'));
  const repo = path.join(base, 'repo');
  fs.mkdirSync(repo);
  sh(repo, 'git', ['-c', 'init.defaultBranch=main', 'init']);
  sh(repo, 'git', ['config', 'user.email', 'test@example.com']);
  sh(repo, 'git', ['config', 'user.name', 'Test']);
  fs.writeFileSync(path.join(repo, 'README.md'), '# repo\n');
  sh(repo, 'git', ['add', '-A']);
  sh(repo, 'git', ['commit', '-m', 'init']);
  sh(repo, 'git', ['checkout', '-b', 'work']);
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  return repo;
}

function commitAll(repo, message) {
  sh(repo, 'git', ['add', '-A']);
  sh(repo, 'git', ['commit', '-m', message]);
}

function scoreRepo(repo) {
  const { config } = readHarnessConfig(repo);
  const changedFiles = changedFilesForCoverage(repo);
  return scoreDiffRisk(changedFiles, config, repo);
}

test('scoreDiffRisk escalates an unconditional, unguarded git worktree remove call, naming the signal', (t) => {
  const repo = initRepo(t);
  fs.writeFileSync(
    path.join(repo, 'src.js'),
    'function landCleanup(root, match) {\n  git(root, ["worktree", "remove", match.path]);\n}\n',
  );
  commitAll(repo, 'add unguarded worktree remove');

  const risk = scoreRepo(repo);
  assert.notEqual(risk.level, 'low', `expected at least medium, got ${risk.level}: ${risk.reason}`);
  assert.match(risk.reason, /worktree remove/i);
  assert.ok(risk.structuralSignals.length > 0, 'structuralSignals must name the match');
});

test('scoreDiffRisk escalates an unconditional, unguarded git branch -D call', (t) => {
  const repo = initRepo(t);
  fs.writeFileSync(
    path.join(repo, 'src.js'),
    'function cleanup(root, branch) {\n  git(root, ["branch", "-D", branch]);\n}\n',
  );
  commitAll(repo, 'add unguarded branch delete');

  const risk = scoreRepo(repo);
  assert.notEqual(risk.level, 'low', `expected at least medium, got ${risk.level}: ${risk.reason}`);
  assert.match(risk.reason, /branch -D/i);
});

test('scoreDiffRisk escalates an unconditional, unattended git merge call', (t) => {
  const repo = initRepo(t);
  fs.writeFileSync(
    path.join(repo, 'src.js'),
    'function autoMerge(root, branch) {\n  git(root, ["merge", branch]);\n}\n',
  );
  commitAll(repo, 'add unguarded merge');

  const risk = scoreRepo(repo);
  assert.notEqual(risk.level, 'low', `expected at least medium, got ${risk.level}: ${risk.reason}`);
  assert.match(risk.reason, /merge/i);
});

test('scoreDiffRisk does not escalate a diff that only touches test/doc files', (t) => {
  const repo = initRepo(t);
  fs.mkdirSync(path.join(repo, 'test'));
  fs.writeFileSync(
    path.join(repo, 'test', 'cleanup.test.js'),
    'git(root, ["worktree", "remove", match.path]);\n',
  );
  fs.writeFileSync(path.join(repo, 'NOTES.md'), 'git(root, ["worktree", "remove", x]);\n');
  commitAll(repo, 'add test/doc mentions only');

  const risk = scoreRepo(repo);
  assert.equal(risk.level, 'low', `expected low (test/doc-only), got ${risk.level}: ${risk.reason}`);
});

test('scoreDiffRisk does not let a guarded call on one line hide an unguarded call on the same line (guard leak)', (t) => {
  const repo = initRepo(t);
  fs.writeFileSync(
    path.join(repo, 'src.js'),
    'function landCleanup(root, match) {\n' +
      '  git(root, ["worktree", "remove", match.path], { allowFail: true }); git(root, ["branch", "-D", match.branch]);\n' +
      '}\n',
  );
  commitAll(repo, 'guarded call followed by unguarded call on the same line');

  const risk = scoreRepo(repo);
  assert.notEqual(
    risk.level,
    'low',
    `the unguarded branch -D call must still be caught, got ${risk.level}: ${risk.reason}`,
  );
  assert.match(risk.reason, /branch -D/i);
});

test('scoreDiffRisk does not treat a content-unchanged rename as a wholly new (100% added) file', (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-harness-risk-'));
  const repo = path.join(base, 'repo');
  fs.mkdirSync(repo);
  sh(repo, 'git', ['-c', 'init.defaultBranch=main', 'init']);
  sh(repo, 'git', ['config', 'user.email', 'test@example.com']);
  sh(repo, 'git', ['config', 'user.name', 'Test']);
  fs.mkdirSync(path.join(repo, 'src'));
  fs.writeFileSync(
    path.join(repo, 'src', 'old.js'),
    'function landCleanup(root, match) {\n  git(root, ["worktree", "remove", match.path]);\n}\n',
  );
  // The file (and its pre-existing unguarded call) already lives on the
  // default branch, at the mergeBase — only the rename happens on the story
  // branch, with no content change.
  sh(repo, 'git', ['add', '-A']);
  sh(repo, 'git', ['commit', '-m', 'init with file already on main']);
  sh(repo, 'git', ['checkout', '-b', 'work']);
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));

  sh(repo, 'git', ['mv', path.join('src', 'old.js'), path.join('src', 'new.js')]);
  commitAll(repo, 'rename only, no content change');

  const risk = scoreRepo(repo);
  assert.equal(
    risk.level,
    'low',
    `a content-unchanged rename must not re-flag pre-existing code as newly added, got ${risk.level}: ${risk.reason}`,
  );
});

test('scoreDiffRisk does not flag an already-allowFail-guarded mutation call (false-positive guard)', (t) => {
  const repo = initRepo(t);
  fs.writeFileSync(
    path.join(repo, 'src.js'),
    'function landCleanup(root, match) {\n' +
      '  const remove = git(root, ["worktree", "remove", match.path], { allowFail: true });\n' +
      '  if (remove.code !== 0) { throw new Error("failed"); }\n' +
      '}\n',
  );
  commitAll(repo, 'add guarded worktree remove');

  const risk = scoreRepo(repo);
  assert.equal(
    risk.level,
    'low',
    `an allowFail-guarded call must not be flagged, got ${risk.level}: ${risk.reason}`,
  );
});

test('scoreDiffRisk does not flag a guarded call whose allowFail sits past the 3-line signature window (guard span truncation)', (t) => {
  const repo = initRepo(t);
  fs.writeFileSync(
    path.join(repo, 'src.js'),
    'function landCleanup(root, match) {\n' +
      '  const remove = git(\n' +
      '    root,\n' +
      '    [\n' +
      '      "worktree",\n' +
      '      "remove",\n' +
      '      match.path,\n' +
      '    ],\n' +
      '    { allowFail: true },\n' +
      '  );\n' +
      '  if (remove.code !== 0) { throw new Error("failed"); }\n' +
      '}\n',
  );
  commitAll(repo, 'add guarded worktree remove spanning many lines');

  const risk = scoreRepo(repo);
  assert.equal(
    risk.level,
    'low',
    `an allowFail-guarded call must not be flagged just because its guard is beyond the signature window, got ${risk.level}: ${risk.reason}`,
  );
});
