'use strict';

// The diff base: coverage, risk and weakening are measured on what a story
// changed since it forked, not on everything since main. These tests pin the
// order of sources and the scope they report, on throwaway repositories.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');

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
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function commit(dir, files, message) {
  for (const [name, content] of Object.entries(files)) {
    const full = path.join(dir, name);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-m', message]);
}

// main <- feature/EPIC-07-x (epic work, incl. a migration) — HEAD on the epic.
function epicRepo(t, { trunk = 'main' } = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-diffbase-')));
  t.after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(`${dir}-worktrees`, { recursive: true, force: true });
  });
  assert.equal(run(dir, ['init']).code, 0);

  git(dir, ['init', '-b', trunk]);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);

  const configPath = path.join(dir, '.coding-flow', 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.validation = { commands: ['node -e "process.exit(0)"'], quality: [] };
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, '.gitignore'), '.coding-flow/runs/\n.coding-flow/*.lock\n');

  commit(dir, { 'README.md': '# x\n' }, 'init');
  git(dir, ['checkout', '-b', 'feature/EPIC-07-x']);
  commit(dir, { 'prisma/migrations/001/migration.sql': 'select 1;\n', 'src/other.ts': 'export const a = 1;\n', 'test/other.test.js': 'x\n' }, 'epic work');
  return dir;
}

// A medium-risk story: the coverage gate only lists changed files once it has
// decided the change is worth gating.
function mediumStory(dir) {
  const rel = 'epics/epic-07-x/story-07-01-geo';
  fs.mkdirSync(path.join(dir, rel), { recursive: true });
  fs.writeFileSync(path.join(dir, rel, 'story.md'), '# Geo\n\nAdd a CRUD form backed by the api.\n');
  return rel;
}

function verifyJson(dir, extra = []) {
  const result = run(dir, ['verify', '--json', '--no-cache', ...extra]);
  return JSON.parse(result.output);
}

const own = (files) => files.filter((f) => !f.startsWith('.coding-flow/'));

test('a worktree add records the fork point and verify measures from it', (t) => {
  const dir = epicRepo(t);
  assert.equal(run(dir, ['worktree', 'add', 'story-07-01-geo', '--from', 'feature/EPIC-07-x']).code, 0);
  const wt = `${dir}-worktrees/story-07-01-geo`;

  assert.equal(git(dir, ['config', '--get', 'branch.story-07-01-geo.codingFlowBase']), 'feature/EPIC-07-x');

  commit(wt, { 'src/geo/a.ts': 'export const g = 1;\n', 'test/geo.test.js': 'y\n', [`${mediumStory(wt)}/story.md`]: '# Geo\n\nAdd a CRUD form backed by the api.\n' }, 'story work');
  const evidence = verifyJson(wt, ['--story', mediumStory(wt)]);

  assert.deepEqual(own(evidence.coverage.changedFiles), [
    'epics/epic-07-x/story-07-01-geo/story.md',
    'src/geo/a.ts',
    'test/geo.test.js',
  ]);
  assert.equal(evidence.diffBase.ref, 'feature/EPIC-07-x');
  assert.equal(evidence.diffBase.source, 'fork-point');
  assert.equal(evidence.diffBase.scope, 'story');
});

test('a worktree add without --from records the branch checked out in the primary', (t) => {
  const dir = epicRepo(t);
  assert.equal(run(dir, ['worktree', 'add', 'story-07-01-geo']).code, 0);

  assert.equal(git(dir, ['config', '--get', 'branch.story-07-01-geo.codingFlowBase']), 'feature/EPIC-07-x');
});

test('a plain git switch -c from the epic branch resolves to the nearest base', (t) => {
  const dir = epicRepo(t);
  git(dir, ['switch', '-c', 'story-07-01-geo']);
  commit(dir, { 'src/geo/a.ts': 'export const g = 1;\n', 'test/geo.test.js': 'y\n', [`${mediumStory(dir)}/story.md`]: '# Geo\n\nAdd a CRUD form backed by the api.\n' }, 'story work');
  const evidence = verifyJson(dir, ['--story', mediumStory(dir)]);

  assert.deepEqual(own(evidence.coverage.changedFiles), [
    'epics/epic-07-x/story-07-01-geo/story.md',
    'src/geo/a.ts',
    'test/geo.test.js',
  ]);
  assert.equal(evidence.diffBase.source, 'nearest');
  assert.equal(evidence.diffBase.ref, 'feature/EPIC-07-x');
});

test('a story is scored on its own files, not on the epic’s migration', (t) => {
  const dir = epicRepo(t);
  git(dir, ['switch', '-c', 'story-07-01-geo']);
  commit(dir, { 'src/geo/a.ts': 'export const g = 1;\n' }, 'story work');
  const evidence = verifyJson(dir);

  // Measured from main, the epic's migration would have made this high risk.
  assert.match(evidence.coverage.reason, /risk is low/);
});

test('config baseBranch wins over the nearest base', (t) => {
  const dir = epicRepo(t);
  git(dir, ['branch', 'develop', 'main']);
  const configPath = path.join(dir, '.coding-flow', 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.baseBranch = 'develop';
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

  const evidence = verifyJson(dir);
  assert.equal(evidence.diffBase.source, 'config');
  assert.equal(evidence.diffBase.ref, 'develop');
});

test('--base wins over everything and an unresolvable one is refused', (t) => {
  const dir = epicRepo(t);
  git(dir, ['switch', '-c', 'story-07-01-geo']);
  commit(dir, { 'src/geo/a.ts': 'export const g = 1;\n' }, 'story work');

  const evidence = verifyJson(dir, ['--base', 'main']);
  assert.equal(evidence.diffBase.source, 'flag');
  assert.ok(own(evidence.coverage.changedFiles).includes('prisma/migrations/001/migration.sql'));

  const bad = run(dir, ['verify', '--base', 'no-such-ref']);
  assert.notEqual(bad.code, 0);
  assert.match(bad.output, /no-such-ref/);
});

test('verify on the epic branch itself reports the epic scope', (t) => {
  const dir = epicRepo(t);
  const evidence = verifyJson(dir);

  assert.equal(evidence.diffBase.scope, 'epic');
  assert.ok(own(evidence.coverage.changedFiles).includes('src/other.ts'));
});

test('no trunk at all: source none, scope working-tree', (t) => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-diffbase-none-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(run(dir, ['init']).code, 0);
  git(dir, ['init', '-b', 'trunk']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  commit(dir, { 'README.md': '# x\n' }, 'init');

  const report = JSON.parse(run(dir, ['harness', 'check', '--json']).output);
  assert.equal(report.diffBase.source, 'none');
  assert.equal(report.diffBase.scope, 'working-tree');
});

test('a test deleted by the epic is not blamed on the story', (t) => {
  const dir = epicRepo(t);
  // Exists on main, removed by the epic: not this story's doing.
  git(dir, ['switch', 'main']);
  commit(dir, { 'test/legacy.test.js': 'assert(1)\n' }, 'legacy test on main');
  git(dir, ['switch', 'feature/EPIC-07-x']);
  git(dir, ['rebase', 'main']);
  git(dir, ['rm', '-q', 'test/legacy.test.js']);
  git(dir, ['commit', '-qm', 'epic removes a test']);
  git(dir, ['switch', '-c', 'story-07-01-geo']);
  commit(dir, { 'src/geo/a.ts': 'export const g = 1;\n', 'test/geo.test.js': 'y\n', [`${mediumStory(dir)}/story.md`]: '# Geo\n\nAdd a CRUD form backed by the api.\n' }, 'story work');

  const story = verifyJson(dir, ['--story', mediumStory(dir)]);
  assert.ok(Array.isArray(story.coverage.changedFiles) && story.coverage.changedFiles.length > 0);
  assert.ok(!(story.coverage.weakenedTests || []).some((f) => f.file === 'test/legacy.test.js'));

  const fromMain = verifyJson(dir, ['--story', mediumStory(dir), '--base', 'main']);
  assert.ok((fromMain.coverage.weakenedTests || []).some((f) => f.file === 'test/legacy.test.js' && f.signal === 'deleted'));
});

test('a recorded fork point whose branch is gone falls through and says so', (t) => {
  const dir = epicRepo(t);
  git(dir, ['switch', '-c', 'story-07-01-geo']);
  git(dir, ['config', 'branch.story-07-01-geo.codingFlowBase', 'feature/EPIC-07-gone']);
  const report = JSON.parse(run(dir, ['harness', 'check', '--json']).output);

  assert.equal(report.diffBase.forkPointMissing, 'feature/EPIC-07-gone');
  assert.equal(report.diffBase.source, 'nearest');
});

test('on a repo whose only base is main, the source is default', (t) => {
  const dir = epicRepo(t);
  git(dir, ['switch', '-c', 'scratch', 'main']);
  git(dir, ['branch', '-D', 'feature/EPIC-07-x']);
  commit(dir, { 'a.txt': 'a\n' }, 'work');
  const report = JSON.parse(run(dir, ['harness', 'check', '--json']).output);

  assert.equal(report.diffBase.source, 'default');
  assert.equal(report.diffBase.ref, 'main');
});

test('a proof made against another base is not reused', (t) => {
  const dir = epicRepo(t);
  git(dir, ['switch', '-c', 'story-07-01-geo']);
  commit(dir, { 'src/geo/a.ts': 'export const g = 1;\n', 'test/geo.test.js': 'y\n' }, 'story work');
  const story = 'epics/epic-07-x/story-07-01-geo';
  fs.mkdirSync(path.join(dir, story), { recursive: true });
  fs.writeFileSync(path.join(dir, story, 'story.md'), '# Geo\n\nCopy change.\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'story file']);

  assert.equal(run(dir, ['verify', '--story', story]).code, 0);
  assert.match(run(dir, ['verify', '--story', story]).output, /already proved/);
  assert.doesNotMatch(run(dir, ['verify', '--story', story, '--base', 'main']).output, /already proved/);
});

test('a configured baseBranch that does not resolve is reported, not silently dropped', (t) => {
  const dir = epicRepo(t);
  const configPath = path.join(dir, '.coding-flow', 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.baseBranch = 'develop-missing';
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

  const report = JSON.parse(run(dir, ['harness', 'check', '--json']).output);
  assert.equal(report.diffBase.configUnresolved, 'develop-missing');
  assert.notEqual(report.diffBase.source, 'config');
});

test('a recorded fork point makes the scope story whatever the branch is called', (t) => {
  const dir = epicRepo(t);
  git(dir, ['switch', '-c', 'wip-geo']);
  git(dir, ['config', 'branch.wip-geo.codingFlowBase', 'feature/EPIC-07-x']);
  const report = JSON.parse(run(dir, ['harness', 'check', '--json']).output);

  assert.equal(report.diffBase.source, 'fork-point');
  assert.equal(report.diffBase.scope, 'story');
});
