'use strict';

// Contract tests for `ai-flow worktree`.
// We set up a real throwaway git repo, run the CLI, and verify the observable
// behavior: directories created, symlinks laid down, branches kept, exit codes.
// Zero dependency: node:test + git.

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

// Throwaway git repo, with a first commit on main. The repo lives in a `repo/`
// subdirectory so that the grouped layout (../repo-worktrees) has a writable
// parent.
function freshRepo(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-wt-'));
  const repo = path.join(base, 'repo');
  fs.mkdirSync(repo);
  sh(repo, 'git', ['-c', 'init.defaultBranch=main', 'init']);
  sh(repo, 'git', ['config', 'user.email', 'test@example.com']);
  sh(repo, 'git', ['config', 'user.name', 'Test']);
  fs.writeFileSync(path.join(repo, 'README.md'), '# repo\n');
  sh(repo, 'git', ['add', '.']);
  sh(repo, 'git', ['commit', '-m', 'init']);
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  return { base, repo };
}

function run(cwd, args) {
  try {
    const output = execFileSync(process.execPath, [CLI, 'worktree', ...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, output };
  } catch (err) {
    return { code: err.status ?? 1, output: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

function worktreePath(base, name) {
  return path.join(base, 'repo-worktrees', name);
}

test('worktree add creates the directory and a new branch', (t) => {
  const { base, repo } = freshRepo(t);
  const { code } = run(repo, ['add', 'feat-x']);
  assert.equal(code, 0, 'add must exit 0');

  const dest = worktreePath(base, 'feat-x');
  assert.ok(fs.existsSync(dest), 'the worktree directory must exist');

  const list = sh(repo, 'git', ['worktree', 'list', '--porcelain']);
  assert.ok(list.includes('refs/heads/feat-x'), 'the feat-x branch must be checked out in a worktree');
});

test('worktree add symlinks the .env files present at the root', (t) => {
  const { base, repo } = freshRepo(t);
  fs.writeFileSync(path.join(repo, '.env'), 'SECRET=1\n');

  run(repo, ['add', 'feat-env']);
  const link = path.join(worktreePath(base, 'feat-env'), '.env');
  assert.ok(fs.lstatSync(link).isSymbolicLink(), '.env must be a symlink in the worktree');
  assert.equal(fs.readFileSync(link, 'utf8'), 'SECRET=1\n', 'the symlink must point to the root .env');
});

test('worktree add --deps link symlinks node_modules', (t) => {
  const { base, repo } = freshRepo(t);
  fs.mkdirSync(path.join(repo, 'node_modules', 'left-pad'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'node_modules', 'left-pad', 'index.js'), '');

  run(repo, ['add', 'feat-deps', '--deps', 'link']);
  const link = path.join(worktreePath(base, 'feat-deps'), 'node_modules');
  assert.ok(fs.lstatSync(link).isSymbolicLink(), 'node_modules must be a symlink with --deps link');
  assert.ok(
    fs.existsSync(path.join(link, 'left-pad', 'index.js')),
    'the node_modules symlink must expose the root content',
  );
});

test('worktree add --dry-run writes nothing', (t) => {
  const { base, repo } = freshRepo(t);
  const { code } = run(repo, ['add', 'feat-dry', '--dry-run']);
  assert.equal(code, 0);
  assert.ok(!fs.existsSync(worktreePath(base, 'feat-dry')), '--dry-run must create no worktree');
});

test('worktree list shows the added worktree', (t) => {
  const { repo } = freshRepo(t);
  run(repo, ['add', 'feat-list']);
  const { code, output } = run(repo, ['list']);
  assert.equal(code, 0);
  assert.ok(output.includes('feat-list'), 'list must mention the added worktree');
});

test('worktree remove removes the worktree but keeps the branch', (t) => {
  const { base, repo } = freshRepo(t);
  run(repo, ['add', 'feat-rm']);
  const dest = worktreePath(base, 'feat-rm');
  assert.ok(fs.existsSync(dest));

  const { code } = run(repo, ['remove', 'feat-rm']);
  assert.equal(code, 0, 'remove must exit 0');
  assert.ok(!fs.existsSync(dest), 'the worktree directory must be deleted');

  const branches = sh(repo, 'git', ['branch', '--list', 'feat-rm']);
  assert.ok(branches.includes('feat-rm'), 'remove must NOT delete the branch');
});

test('worktree remove succeeds despite our own .env symlinks', (t) => {
  const { base, repo } = freshRepo(t);
  fs.writeFileSync(path.join(repo, '.env'), 'SECRET=1\n');
  run(repo, ['add', 'feat-envrm']);
  // The .env is NOT gitignored here: without handling, the symlink laid down by
  // add would appear as an untracked file and block remove.
  const { code } = run(repo, ['remove', 'feat-envrm']);
  assert.equal(code, 0, 'our own links must not block remove');
  assert.ok(!fs.existsSync(worktreePath(base, 'feat-envrm')), 'the worktree must be deleted');
});

test('worktree add on a non-JS project never recommends npm install', (t) => {
  const { base, repo } = freshRepo(t);
  fs.writeFileSync(path.join(repo, 'go.mod'), 'module demo\n\ngo 1.21\n');

  const { code, output } = run(repo, ['add', 'feat-go', '--dry-run']);
  assert.equal(code, 0, output);
  assert.doesNotMatch(output, /npm install/, 'no JS package manager was detected, so npm must not be guessed');
  assert.match(output, /no known JS package manager detected/);
  assert.ok(!fs.existsSync(worktreePath(base, 'feat-go')), '--dry-run must create no worktree');
});

test('worktree remove refuses a dirty worktree without --force', (t) => {
  const { base, repo } = freshRepo(t);
  run(repo, ['add', 'feat-dirty']);
  fs.writeFileSync(path.join(worktreePath(base, 'feat-dirty'), 'wip.txt'), 'uncommitted work');

  const { code } = run(repo, ['remove', 'feat-dirty']);
  assert.notEqual(code, 0, 'remove must refuse while the worktree is dirty');
  assert.ok(fs.existsSync(worktreePath(base, 'feat-dirty')), 'the dirty worktree must stay intact');
});
