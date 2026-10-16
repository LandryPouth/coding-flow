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
  assert.match(output, /would commit as/i);

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

// Shared checkout, story branch: the branch touched src/geo/a.ts; the tree also
// carries unrelated work.
function storyRepo(t) {
  const { originDir, repo } = repoWithOrigin(t, { withFeature: false });
  const storyName = 'story-01-01-geo';
  const storyDir = path.join('epics', 'epic-01-geo', storyName);
  fs.mkdirSync(path.join(repo, 'src', 'geo'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'src', 'billing'), { recursive: true });
  fs.mkdirSync(path.join(repo, storyDir), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src', 'geo', 'a.ts'), 'a\n');
  fs.writeFileSync(path.join(repo, 'src', 'billing', 'b.ts'), 'b\n');
  fs.writeFileSync(path.join(repo, storyDir, 'tasks.md'), '# Story 01-01 — Geo\n');
  sh(repo, 'git', ['add', '.']);
  sh(repo, 'git', ['commit', '-m', 'base files']);
  sh(repo, 'git', ['push', 'origin', 'main']);
  sh(repo, 'git', ['checkout', '-b', storyName]);
  fs.writeFileSync(path.join(repo, 'src', 'geo', 'a.ts'), 'a1\n');
  sh(repo, 'git', ['commit', '-am', 'touch a']);
  // now dirty: a (in scope), b (not), new c beside a, story tasks.md
  fs.writeFileSync(path.join(repo, 'src', 'geo', 'a.ts'), 'a2\n');
  fs.writeFileSync(path.join(repo, 'src', 'billing', 'b.ts'), 'b2\n');
  fs.writeFileSync(path.join(repo, 'src', 'geo', 'c.ts'), 'c\n');
  fs.writeFileSync(path.join(repo, storyDir, 'tasks.md'), '# Story 01-01 — Geo\n- [x] done\n');
  return { originDir, repo, storyName };
}

function lastCommitFiles(repo) {
  return sh(repo, 'git', ['show', '--name-only', '--format=', 'HEAD']).trim().split('\n').sort();
}

test('ship commits only the story scope and lists what it left out', (t) => {
  const { repo } = storyRepo(t);
  const { code, output } = run(repo, []);
  assert.equal(code, 0, output);
  assert.deepEqual(lastCommitFiles(repo), [
    'epics/epic-01-geo/story-01-01-geo/tasks.md',
    'src/geo/a.ts',
    'src/geo/c.ts',
  ]);
  assert.match(output, /Left out of the commit \(not in this story's scope\): src\/billing\/b\.ts/);
  assert.match(sh(repo, 'git', ['status', '--porcelain']), /src\/billing\/b\.ts/);
});

test('ship --all commits the whole dirty tree', (t) => {
  const { repo } = storyRepo(t);
  const { code, output } = run(repo, ['--all']);
  assert.equal(code, 0, output);
  assert.equal(lastCommitFiles(repo).length, 4);
  assert.equal(sh(repo, 'git', ['status', '--porcelain']).trim(), '');
});

test('ship --dry-run prints the include and exclude lists and commits nothing', (t) => {
  const { repo } = storyRepo(t);
  const before = sh(repo, 'git', ['rev-parse', 'HEAD']);
  const { code, output } = run(repo, ['--dry-run']);
  assert.equal(code, 0, output);
  assert.match(output, /include: .*src\/geo\/a\.ts/);
  assert.match(output, /exclude: src\/billing\/b\.ts/);
  assert.equal(sh(repo, 'git', ['rev-parse', 'HEAD']), before);
});

test('ship in a story worktree commits everything without --all', (t) => {
  const { repo, storyName } = storyRepo(t);
  sh(repo, 'git', ['stash', '-u']);
  sh(repo, 'git', ['checkout', 'main']);
  const wt = path.join(path.dirname(repo), 'wt');
  sh(repo, 'git', ['worktree', 'add', wt, storyName]);
  fs.writeFileSync(path.join(wt, 'src', 'billing', 'b.ts'), 'b3\n');
  fs.writeFileSync(path.join(wt, 'elsewhere.txt'), 'x\n');
  const { code, output } = run(wt, []);
  assert.equal(code, 0, output);
  assert.deepEqual(lastCommitFiles(wt), ['elsewhere.txt', 'src/billing/b.ts']);
});

test('a secret in a left-out file does not block ship; one in a staged file does', (t) => {
  const { repo } = storyRepo(t);
  const secret = `const k = "AKIA${'ABCDEFGHIJKLMNOP'}";\n`;
  fs.writeFileSync(path.join(repo, 'src', 'billing', 'b.ts'), secret);
  const ok = run(repo, []);
  assert.equal(ok.code, 0, ok.output);

  fs.writeFileSync(path.join(repo, 'src', 'geo', 'a.ts'), secret);
  const blocked = run(repo, []);
  assert.notEqual(blocked.code, 0, 'a secret in a staged file must block');
  assert.match(blocked.output, /secret/i);
});

test('ship handles staged deletions and renames in scope, and keeps left-out files unstaged', (t) => {
  const { repo } = storyRepo(t);
  fs.writeFileSync(path.join(repo, 'src', 'geo', 'del.ts'), 'd\n');
  sh(repo, 'git', ['add', 'src/geo/del.ts']);
  sh(repo, 'git', ['commit', '-m', 'add del (branch touches geo)']);
  sh(repo, 'git', ['rm', '-q', 'src/geo/del.ts']);
  sh(repo, 'git', ['mv', 'src/geo/a.ts', 'src/geo/a2.ts']);
  // a file staged by hand but outside the story must stay out of the commit
  fs.writeFileSync(path.join(repo, 'src', 'billing', 'staged.ts'), 's\n');
  sh(repo, 'git', ['add', 'src/billing/staged.ts']);

  const { code, output } = run(repo, []);
  assert.equal(code, 0, output);
  const files = lastCommitFiles(repo);
  assert.ok(files.includes('src/geo/del.ts'), 'staged deletion committed');
  assert.ok(files.includes('src/geo/a2.ts') && files.includes('src/geo/a.ts'), 'rename committed as a unit');
  assert.ok(!files.includes('src/billing/staged.ts'), 'pre-staged out-of-scope file stays out');
  assert.match(sh(repo, 'git', ['status', '--porcelain']), /src\/billing\/b\.ts/);
});

test('a touched root-level file does not sweep unrelated root files into the commit', (t) => {
  const { repo } = storyRepo(t);
  fs.writeFileSync(path.join(repo, 'NOTES.md'), 'n\n');
  sh(repo, 'git', ['add', 'NOTES.md']);
  sh(repo, 'git', ['commit', '-m', 'root file']);
  fs.writeFileSync(path.join(repo, 'scratch.txt'), 'x\n');
  const { code, output } = run(repo, []);
  assert.equal(code, 0, output);
  assert.ok(!lastCommitFiles(repo).includes('scratch.txt'));
  assert.match(output, /scratch\.txt/);
});

test('ship takes the run files produced for this story and leaves another story\'s out', (t) => {
  const { repo, storyName } = storyRepo(t);
  const runs = path.join(repo, '.coding-flow', 'runs');
  fs.mkdirSync(runs, { recursive: true });
  const storyPath = `epics/epic-01-geo/${storyName}`;
  fs.writeFileSync(path.join(runs, 'mine-verify.json'), JSON.stringify({ story: storyPath }));
  fs.writeFileSync(path.join(runs, 'other-verify.json'), JSON.stringify({ story: 'epics/epic-02-x/story-02-01-x' }));
  const { code, output } = run(repo, []);
  assert.equal(code, 0, output);
  const files = lastCommitFiles(repo);
  assert.ok(files.includes('.coding-flow/runs/mine-verify.json'));
  assert.ok(!files.includes('.coding-flow/runs/other-verify.json'));
  assert.match(output, /other-verify\.json/);
});

test('ship on a branch with no linked story warns and commits the whole tree', (t) => {
  const { repo } = storyRepo(t);
  sh(repo, 'git', ['branch', '-m', 'feat/unlinked']);
  const { code, output } = run(repo, []);
  assert.equal(code, 0, output);
  assert.match(output, /no story is linked/i);
  assert.equal(lastCommitFiles(repo).length, 4);
});

test('ship refuses a scoped commit while a merge is unfinished, and says why', (t) => {
  const { repo } = storyRepo(t);
  const gitDir = sh(repo, 'git', ['rev-parse', '--absolute-git-dir']).trim();
  fs.writeFileSync(path.join(gitDir, 'MERGE_HEAD'), `${sh(repo, 'git', ['rev-parse', 'HEAD']).trim()}\n`);
  const { code, output } = run(repo, []);
  assert.notEqual(code, 0);
  assert.match(output, /merge or cherry-pick is in progress/);
  assert.match(output, /--all/);
});
