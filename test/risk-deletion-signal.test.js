'use strict';

// Story 13-14: new code that deletes the user's files is a structural risk
// signal, so the coverage gate runs on it. Found by the review of story 17-01,
// whose `ai-flow archive` runs `git(["rm", "-r", "-q", "--", rel])` and scored
// `low`. Real temp git repos, like test/harness-risk.test.js.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { scoreDiffRisk } = require('../bin/lib/risk');
const { readHarnessConfig } = require('../bin/lib/harness-config');
const { changedFilesForCoverage } = require('../bin/lib/diff-scope');

function sh(cwd, cmd, args) {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function repoAdding(t, source) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-risk-deletion-'));
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
  fs.writeFileSync(path.join(repo, 'src.js'), source);
  sh(repo, 'git', ['add', '-A']);
  sh(repo, 'git', ['commit', '-m', 'add deletion']);
  const { config } = readHarnessConfig(repo);
  return scoreDiffRisk(changedFilesForCoverage(repo), config, repo);
}

function assertFlagged(risk, signal) {
  assert.notEqual(risk.level, 'low', `expected at least medium, got ${risk.level}: ${risk.reason}`);
  assert.ok(
    risk.structuralSignals.some((m) => signal.test(m.signal)),
    `expected a ${signal} signal, got ${JSON.stringify(risk.structuralSignals)}`,
  );
}

test('the 17-01 shape: git(["rm", "-r", …]) with no root argument is flagged', (t) => {
  const risk = repoAdding(t, 'function archive(state) {\n  git(["rm", "-r", "-q", "--", state.rel]);\n}\n');
  assertFlagged(risk, /git rm/);
  assert.match(risk.reason, /git rm/);
});

test('git(root, ["rm", path]) without flags is flagged', (t) => {
  assertFlagged(repoAdding(t, 'function drop(root, p) {\n  git(root, ["rm", p]);\n}\n'), /git rm/);
});

test('git clean is flagged', (t) => {
  assertFlagged(repoAdding(t, 'function wipe(root) {\n  git(root, ["clean", "-fdx"]);\n}\n'), /git clean/);
});

test('fs.rmSync with recursive: true is flagged, the options on the next line included', (t) => {
  assertFlagged(
    repoAdding(t, 'function purge(dir) {\n  fs.rmSync(dir, {\n    recursive: true,\n    force: true,\n  });\n}\n'),
    /recursive delete/,
  );
});

test('fs.rmdirSync and fs.promises.rm with recursive: true are flagged', (t) => {
  assertFlagged(
    repoAdding(t, 'function purge(dir) {\n  fs.rmdirSync(dir, { recursive: true });\n}\n'),
    /recursive delete/,
  );
  assertFlagged(
    repoAdding(t, 'async function purge(dir) {\n  await fs.promises.rm(dir, { recursive: true });\n}\n'),
    /recursive delete/,
  );
});

test('a git rm guarded with allowFail keeps today\'s score', (t) => {
  const risk = repoAdding(
    t,
    'function drop(root, p) {\n  const r = git(root, ["rm", "--", p], { allowFail: true });\n  return r.code;\n}\n',
  );
  assert.equal(risk.level, 'low', `got ${risk.level}: ${risk.reason}`);
});

test('a non-recursive delete and a plain git status stay low', (t) => {
  const risk = repoAdding(
    t,
    'function tidy(root, f) {\n  fs.rmSync(f, { force: true });\n  fs.unlinkSync(f);\n  git(root, ["status", "--porcelain"]);\n}\n',
  );
  assert.equal(risk.level, 'low', `got ${risk.level}: ${risk.reason}`);
});

test('a word ending in rm (confirm, transform) is not a delete', (t) => {
  const risk = repoAdding(
    t,
    'function ask(x) {\n  confirm(x, { recursive: true });\n  transform(x, { recursive: true });\n}\n',
  );
  assert.equal(risk.level, 'low', `got ${risk.level}: ${risk.reason}`);
});
