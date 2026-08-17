'use strict';

// Contract tests for `ai-flow ship`.
// We set up a real git repo + a local bare "origin" remote. Since the origin is
// not github.com, the gh branch (PR creation) is deliberately short-circuited:
// the tests stay hermetic whether or not `gh` is installed on the machine. We
// verify the guardrails and the actual push.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');

function sh(cwd, cmd, args) {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function run(cwd, args) {
  try {
    const output = execFileSync(process.execPath, [CLI, 'ship', ...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, output };
  } catch (err) {
    return { code: err.status ?? 1, output: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

// Repo with a local bare remote named origin, an initial commit on main pushed,
// and (by default) a feature branch checked out with a commit.
function repoWithOrigin(t, { withFeature = true } = {}) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-ship-'));
  const originDir = path.join(baseDir, 'origin.git');
  const repo = path.join(baseDir, 'repo');
  fs.mkdirSync(repo);

  sh(baseDir, 'git', ['init', '--bare', 'origin.git']);
  sh(repo, 'git', ['-c', 'init.defaultBranch=main', 'init']);
  sh(repo, 'git', ['config', 'user.email', 'test@example.com']);
  sh(repo, 'git', ['config', 'user.name', 'Test']);
  sh(repo, 'git', ['remote', 'add', 'origin', originDir]);
  fs.writeFileSync(path.join(repo, 'README.md'), '# repo\n');
  sh(repo, 'git', ['add', '.']);
  sh(repo, 'git', ['commit', '-m', 'init']);
  sh(repo, 'git', ['push', '-u', 'origin', 'main']);

  if (withFeature) {
    sh(repo, 'git', ['checkout', '-b', 'feat/payments']);
    fs.writeFileSync(path.join(repo, 'feature.txt'), 'work\n');
    sh(repo, 'git', ['add', '.']);
    sh(repo, 'git', ['commit', '-m', 'add feature']);
  }

  t.after(() => fs.rmSync(baseDir, { recursive: true, force: true }));
  return { baseDir, originDir, repo };
}

function originHasBranch(originDir, branch) {
  const refs = sh(originDir, 'git', ['branch', '--list', branch]);
  return refs.includes(branch);
}

test('ship refuses when on the base', (t) => {
  const { repo } = repoWithOrigin(t, { withFeature: false });
  const { code, output } = run(repo, []);
  assert.notEqual(code, 0, 'ship must refuse from main');
  assert.match(output, /base/i, 'the message must explain that we are on the base');
});

test('ship refuses without an origin remote', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-ship-noorigin-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  sh(dir, 'git', ['-c', 'init.defaultBranch=main', 'init']);
  sh(dir, 'git', ['config', 'user.email', 't@e.com']);
  sh(dir, 'git', ['config', 'user.name', 'T']);
  fs.writeFileSync(path.join(dir, 'a.txt'), 'x\n');
  sh(dir, 'git', ['add', '.']);
  sh(dir, 'git', ['commit', '-m', 'init']);
  sh(dir, 'git', ['checkout', '-b', 'feat/x']);
  fs.writeFileSync(path.join(dir, 'b.txt'), 'y\n');
  sh(dir, 'git', ['add', '.']);
  sh(dir, 'git', ['commit', '-m', 'work']);

  const { code, output } = run(dir, []);
  assert.notEqual(code, 0, 'ship must refuse without origin');
  assert.match(output, /origin/i, 'the message must mention origin');
});

test('ship refuses when there is no commit above the base', (t) => {
  const { repo } = repoWithOrigin(t, { withFeature: false });
  // Branch without an extra commit.
  sh(repo, 'git', ['checkout', '-b', 'feat/empty']);
  const { code, output } = run(repo, []);
  assert.notEqual(code, 0, 'ship must refuse a branch with nothing to ship');
  assert.match(output, /commit/i, 'the message must talk about commits');
});

test('ship --dry-run pushes nothing', (t) => {
  const { originDir, repo } = repoWithOrigin(t);
  const { code } = run(repo, ['--dry-run']);
  assert.equal(code, 0, 'ship --dry-run must exit 0');
  assert.ok(!originHasBranch(originDir, 'feat/payments'), '--dry-run must push no branch');
});

test('ship pushes the feature branch to origin', (t) => {
  const { originDir, repo } = repoWithOrigin(t);
  const { code, output } = run(repo, []);
  assert.equal(code, 0, `ship must succeed (${output})`);
  assert.ok(originHasBranch(originDir, 'feat/payments'), 'the branch must exist on origin after ship');
});

test('ship on a non-GitHub remote pushes without managing a PR', (t) => {
  const { repo } = repoWithOrigin(t);
  const { code, output } = run(repo, []);
  assert.equal(code, 0);
  assert.match(output, /non-GitHub/i, 'on a non-GitHub remote, no PR is attempted');
});

test('ship commits a dirty tree before pushing it', (t) => {
  const { originDir, repo } = repoWithOrigin(t, { withFeature: false });
  sh(repo, 'git', ['checkout', '-b', 'feat/dirty']);
  fs.writeFileSync(path.join(repo, 'feature.txt'), 'work\n');

  const { code, output } = run(repo, []);
  assert.equal(code, 0, `ship must succeed (${output})`);
  assert.match(output, /Committed:/i, 'ship must report the automatic commit');
  assert.ok(originHasBranch(originDir, 'feat/dirty'), 'the auto-committed work must reach origin');

  const status = sh(repo, 'git', ['status', '--porcelain']).trim();
  assert.equal(status, '', 'the working tree must be clean after the auto-commit');
});

test('ship --dry-run reports the auto-commit it would make, without committing', (t) => {
  const { repo } = repoWithOrigin(t, { withFeature: false });
  sh(repo, 'git', ['checkout', '-b', 'feat/dirty']);
  fs.writeFileSync(path.join(repo, 'feature.txt'), 'work\n');

  const { code, output } = run(repo, ['--dry-run']);
  assert.equal(code, 0);
  assert.match(output, /would commit the dirty tree/i);

  const status = sh(repo, 'git', ['status', '--porcelain']).trim();
  assert.notEqual(status, '', '--dry-run must not actually commit');
});

test('ship --no-commit leaves a dirty tree uncommitted and pushes only existing commits', (t) => {
  const { repo } = repoWithOrigin(t);
  fs.writeFileSync(path.join(repo, 'extra.txt'), 'uncommitted\n');

  const { code, output } = run(repo, ['--no-commit']);
  assert.equal(code, 0, `ship must succeed (${output})`);
  assert.match(output, /dirty working tree/i);
  assert.doesNotMatch(output, /Committed:/i, '--no-commit must not auto-commit');

  const status = sh(repo, 'git', ['status', '--porcelain']).trim();
  assert.match(status, /extra\.txt/, 'the extra file must remain uncommitted');
});
