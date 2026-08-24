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

// --- lock / unlock ----------------------------------------------------------

function makeStory(repo, rel) {
  const dir = path.join(repo, rel);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'story.md'), '# Story\n');
  return dir;
}

function lockPath(repo) {
  return path.join(repo, '.coding-flow', 'active-story.json');
}

function readLock(repo) {
  return JSON.parse(fs.readFileSync(lockPath(repo), 'utf8'));
}

test('worktree lock creates the lock file for a fresh checkout', (t) => {
  const { repo } = freshRepo(t);
  makeStory(repo, 'epics/epic-01/story-01-01');

  const { code } = run(repo, ['lock', '--story', 'epics/epic-01/story-01-01']);
  assert.equal(code, 0, 'lock must exit 0');

  const lock = readLock(repo);
  assert.equal(lock.story, 'epics/epic-01/story-01-01');
  assert.ok(lock.startedAt, 'lock must record a timestamp');
});

test('worktree lock is a no-op when re-locking the same story', (t) => {
  const { repo } = freshRepo(t);
  makeStory(repo, 'epics/epic-01/story-01-01');
  run(repo, ['lock', '--story', 'epics/epic-01/story-01-01']);
  const before = fs.readFileSync(lockPath(repo), 'utf8');

  const { code } = run(repo, ['lock', '--story', 'epics/epic-01/story-01-01']);
  assert.equal(code, 0, 're-locking the same story must exit 0');
  assert.equal(fs.readFileSync(lockPath(repo), 'utf8'), before, 'the lock file must be unchanged');
});

test('worktree lock refuses a different story on an occupied checkout', (t) => {
  const { repo } = freshRepo(t);
  makeStory(repo, 'epics/epic-01/story-01-01');
  makeStory(repo, 'epics/epic-01/story-01-02');
  run(repo, ['lock', '--story', 'epics/epic-01/story-01-01']);
  const before = fs.readFileSync(lockPath(repo), 'utf8');

  const { code, output } = run(repo, ['lock', '--story', 'epics/epic-01/story-01-02']);
  assert.notEqual(code, 0, 'lock must refuse a conflicting story');
  assert.match(output, /epics\/epic-01\/story-01-01/, 'the message must name the locked story');
  assert.match(output, /worktree add --story epics\/epic-01\/story-01-02/, 'the message must suggest isolating the new story');
  assert.equal(fs.readFileSync(lockPath(repo), 'utf8'), before, 'the lock file must be untouched');
});

test('worktree unlock removes a matching lock', (t) => {
  const { repo } = freshRepo(t);
  makeStory(repo, 'epics/epic-01/story-01-01');
  run(repo, ['lock', '--story', 'epics/epic-01/story-01-01']);

  const { code } = run(repo, ['unlock', '--story', 'epics/epic-01/story-01-01']);
  assert.equal(code, 0, 'unlock must exit 0');
  assert.ok(!fs.existsSync(lockPath(repo)), 'the lock file must be removed');
});

test('worktree unlock refuses a mismatched story without --force', (t) => {
  const { repo } = freshRepo(t);
  makeStory(repo, 'epics/epic-01/story-01-01');
  makeStory(repo, 'epics/epic-01/story-01-02');
  run(repo, ['lock', '--story', 'epics/epic-01/story-01-01']);

  const { code } = run(repo, ['unlock', '--story', 'epics/epic-01/story-01-02']);
  assert.notEqual(code, 0, 'unlock must refuse a mismatched story');
  assert.ok(fs.existsSync(lockPath(repo)), 'the lock file must be untouched');
});

test('worktree unlock --force clears the lock regardless of which story it names', (t) => {
  const { repo } = freshRepo(t);
  makeStory(repo, 'epics/epic-01/story-01-01');
  makeStory(repo, 'epics/epic-01/story-01-02');
  run(repo, ['lock', '--story', 'epics/epic-01/story-01-01']);

  const { code } = run(repo, ['unlock', '--story', 'epics/epic-01/story-01-02', '--force']);
  assert.equal(code, 0, '--force must clear a mismatched lock');
  assert.ok(!fs.existsSync(lockPath(repo)), 'the lock file must be removed');
});

test('worktree lock adds the lock file to .gitignore when it is missing entirely', (t) => {
  const { repo } = freshRepo(t);
  makeStory(repo, 'epics/epic-01/story-01-01');
  assert.ok(!fs.existsSync(path.join(repo, '.gitignore')));

  run(repo, ['lock', '--story', 'epics/epic-01/story-01-01']);
  const gitignore = fs.readFileSync(path.join(repo, '.gitignore'), 'utf8');
  assert.match(gitignore, /^\.coding-flow\/active-story\.json$/m);

  const status = sh(repo, 'git', ['status', '--porcelain']);
  assert.doesNotMatch(status, /active-story\.json/, 'the lock file must never show as untracked');
});

test('worktree lock appends to an existing .gitignore that does not yet cover the lock file', (t) => {
  const { repo } = freshRepo(t);
  makeStory(repo, 'epics/epic-01/story-01-01');
  fs.writeFileSync(path.join(repo, '.gitignore'), 'node_modules\n');

  run(repo, ['lock', '--story', 'epics/epic-01/story-01-01']);
  const gitignore = fs.readFileSync(path.join(repo, '.gitignore'), 'utf8');
  assert.equal(gitignore, 'node_modules\n.coding-flow/active-story.json\n');
});

test('worktree lock leaves an already-covering .gitignore byte-for-byte unchanged', (t) => {
  const { repo } = freshRepo(t);
  makeStory(repo, 'epics/epic-01/story-01-01');
  const original = 'node_modules\n.coding-flow/active-story.json\n';
  fs.writeFileSync(path.join(repo, '.gitignore'), original);

  run(repo, ['lock', '--story', 'epics/epic-01/story-01-01']);
  assert.equal(fs.readFileSync(path.join(repo, '.gitignore'), 'utf8'), original);
});

test('worktree lock treats a broader .coding-flow pattern as already covering the lock file', (t) => {
  const { repo } = freshRepo(t);
  makeStory(repo, 'epics/epic-01/story-01-01');
  const original = '.coding-flow/\n';
  fs.writeFileSync(path.join(repo, '.gitignore'), original);

  run(repo, ['lock', '--story', 'epics/epic-01/story-01-01']);
  assert.equal(fs.readFileSync(path.join(repo, '.gitignore'), 'utf8'), original);
});

test('worktree lock refuses with no --story given', (t) => {
  const { repo } = freshRepo(t);

  const { code, output } = run(repo, ['lock']);
  assert.notEqual(code, 0, 'lock must refuse without --story');
  assert.match(output, /--story/, 'the message must mention the missing flag');
  assert.ok(!fs.existsSync(lockPath(repo)), 'no lock file must be created');
});

test('worktree unlock is a no-op when no lock is present', (t) => {
  const { repo } = freshRepo(t);
  makeStory(repo, 'epics/epic-01/story-01-01');

  const { code } = run(repo, ['unlock', '--story', 'epics/epic-01/story-01-01']);
  assert.equal(code, 0, 'unlock with nothing to unlock must still exit 0');
  assert.ok(!fs.existsSync(lockPath(repo)), 'there must still be no lock file');
});
