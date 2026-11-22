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

// Story 13-07: a fork point belongs to a story branch. `develop` once carried
// one (a SHA past its own history), and every verify from develop measured
// "all of develop since that commit".
test('a fork point recorded on develop is ignored and named, not used as a story scope', (t) => {
  const dir = epicRepo(t);
  git(dir, ['switch', '-c', 'develop', 'main']);
  commit(dir, { 'src/a.ts': 'export const a = 1;\n' }, 'develop work');
  const recorded = git(dir, ['rev-parse', 'HEAD']);
  commit(dir, { 'src/b.ts': 'export const b = 1;\n' }, 'more develop work');
  git(dir, ['config', 'branch.develop.codingFlowBase', recorded]);

  const report = JSON.parse(run(dir, ['harness', 'check', '--json']).output);
  assert.notEqual(report.diffBase.source, 'fork-point');
  assert.notEqual(report.diffBase.scope, 'story');
  assert.equal(report.diffBase.ref, 'main');
  assert.equal(report.diffBase.forkPointIgnored.value, recorded);
  assert.match(report.diffBase.forkPointIgnored.reason, /develop.*base branch/);

  const text = run(dir, ['verify', '--no-cache']);
  assert.match(text.output, new RegExp(`fork point ${recorded} ignored`));
});

test('a fork point recorded on the default branch or the configured baseBranch is ignored', (t) => {
  const dir = epicRepo(t);
  git(dir, ['switch', 'main']);
  git(dir, ['config', 'branch.main.codingFlowBase', 'feature/EPIC-07-x']);
  const onMain = JSON.parse(run(dir, ['harness', 'check', '--json']).output).diffBase;
  assert.notEqual(onMain.source, 'fork-point');
  assert.equal(onMain.forkPointIgnored.value, 'feature/EPIC-07-x');

  git(dir, ['switch', '-c', 'trunk']);
  const configPath = path.join(dir, '.coding-flow', 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.baseBranch = 'trunk';
  commit(dir, { '.coding-flow/config.json': `${JSON.stringify(config, null, 2)}\n` }, 'trunk is the base');
  git(dir, ['switch', 'main']);
  git(dir, ['merge', '-q', '--ff-only', 'trunk']);
  git(dir, ['switch', 'trunk']);
  git(dir, ['config', 'branch.trunk.codingFlowBase', 'feature/EPIC-07-x']);
  const onTrunk = JSON.parse(run(dir, ['harness', 'check', '--json']).output).diffBase;
  assert.notEqual(onTrunk.source, 'fork-point');
  assert.equal(onTrunk.forkPointIgnored.value, 'feature/EPIC-07-x');
});

test('worktree add on a base branch name records no fork point', (t) => {
  const dir = epicRepo(t);
  git(dir, ['switch', 'main']);
  assert.equal(run(dir, ['worktree', 'add', 'develop', '--from', 'main', '--deps', 'skip']).code, 0);
  assert.throws(() => git(dir, ['config', '--get', 'branch.develop.codingFlowBase']));

  // A story name still records it (the existing fork-point tests pin the value).
  assert.equal(run(dir, ['worktree', 'add', 'story-07-09-x', '--from', 'main', '--deps', 'skip']).code, 0);
  assert.equal(git(dir, ['config', '--get', 'branch.story-07-09-x.codingFlowBase']), 'main');
});

// A story that commits `baseBranch: <itself>` would measure itself against
// itself: an empty diff, and a strict bar at the base that never applies.
test('a baseBranch set by the branch itself to its own name does not empty the diff', (t) => {
  const dir = epicRepo(t);
  git(dir, ['switch', '-c', 'story-07-01-geo']);
  const configPath = path.join(dir, '.coding-flow', 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.baseBranch = 'story-07-01-geo';
  commit(dir, { 'src/geo/a.ts': 'export const g = 1;\n', '.coding-flow/config.json': `${JSON.stringify(config, null, 2)}\n` }, 'story work');

  const report = JSON.parse(run(dir, ['harness', 'check', '--json']).output);
  assert.notEqual(report.diffBase.source, 'config');
  assert.equal(report.diffBase.ref, 'feature/EPIC-07-x');
  assert.equal(report.diffBase.configIgnored.value, 'story-07-01-geo');
  assert.match(report.diffBase.configIgnored.reason, /names this branch itself \(1 commit\(s\) of its own since feature\/EPIC-07-x\)/);
});

test('a baseBranch committed at the base applies to a story forked from it', (t) => {
  const dir = epicRepo(t);
  const configPath = path.join(dir, '.coding-flow', 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.baseBranch = 'feature/EPIC-07-x';
  commit(dir, { '.coding-flow/config.json': `${JSON.stringify(config, null, 2)}\n` }, 'epic base');
  git(dir, ['switch', '-c', 'story-07-01-geo']);
  commit(dir, { 'src/geo/a.ts': 'export const g = 1;\n' }, 'story work');

  const report = JSON.parse(run(dir, ['harness', 'check', '--json']).output);
  assert.equal(report.diffBase.source, 'config');
  assert.equal(report.diffBase.configIgnored, undefined);
});

test('--base HEAD on a branch with commits of its own is refused and says why', (t) => {
  const dir = epicRepo(t);
  git(dir, ['switch', '-c', 'story-07-01-geo']);
  commit(dir, { 'src/geo/a.ts': 'export const g = 1;\n' }, 'story work');

  const refused = run(dir, ['verify', '--no-cache', '--base', 'HEAD']);
  assert.notEqual(refused.code, 0);
  assert.match(refused.output, /--base "HEAD".*1 commit.*feature\/EPIC-07-x/s);

  // Without commits of its own there is nothing to hide: allowed.
  git(dir, ['switch', '-c', 'story-07-02-empty', 'feature/EPIC-07-x']);
  assert.equal(run(dir, ['verify', '--no-cache', '--base', 'HEAD']).code, 0);
});

// A repository with no main, no develop: its only base is the baseBranch it
// commits. A story that renames it to itself is measured from the value its
// history carried before.
function trunkRepo(t, { story = 'story-01-01-x' } = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-diffbase-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(run(dir, ['init']).code, 0);
  git(dir, ['init', '-b', 'trunk']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  fs.writeFileSync(path.join(dir, '.gitignore'), '.coding-flow/runs/\n.coding-flow/*.lock\n');
  commit(dir, { 'README.md': '# x\n', '.coding-flow/config.json': configWith(dir, { baseBranch: 'trunk' }) }, 'init');
  if (story) git(dir, ['switch', '-c', story]);
  return dir;
}

function configWith(dir, fields) {
  const configPath = path.join(dir, '.coding-flow', 'config.json');
  const config = { ...JSON.parse(fs.readFileSync(configPath, 'utf8')), validation: { commands: ['node -e "process.exit(0)"'], quality: [] }, ...fields };
  return `${JSON.stringify(config, null, 2)}\n`;
}

test('on a trunk-only repository, a story that sets baseBranch to itself is measured from trunk', (t) => {
  const dir = trunkRepo(t);
  commit(dir, { 'src/a.js': '1\n', '.coding-flow/config.json': configWith(dir, { baseBranch: 'story-01-01-x' }) }, 'own');

  const report = JSON.parse(run(dir, ['harness', 'check', '--json']).output);
  assert.equal(report.diffBase.ref, 'trunk');
  assert.equal(report.diffBase.configIgnored.value, 'story-01-01-x');

  const refused = run(dir, ['verify', '--no-cache', '--base', 'HEAD']);
  assert.notEqual(refused.code, 0);
  assert.match(refused.output, /Pass --base trunk/);
});

test('a story whose only known base is itself is refused, not measured against nothing', (t) => {
  const dir = trunkRepo(t, { story: null });
  git(dir, ['branch', '-m', 'trunk', 'story-01-01-x']);
  commit(dir, { 'src/a.js': '1\n', '.coding-flow/config.json': configWith(dir, { baseBranch: 'story-01-01-x' }) }, 'own');

  const result = run(dir, ['verify', '--no-cache']);
  assert.notEqual(result.code, 0);
  assert.match(result.output, /names this branch itself/);
});

// The configured base branch, ahead of a stale main: verifying on it is a
// choice, as on develop, whoever committed the setting.
test('on the configured base branch ahead of a stale main, baseBranch and --base HEAD still apply', (t) => {
  const dir = epicRepo(t);
  git(dir, ['switch', '-c', 'trunk', 'main']);
  for (const i of [1, 2, 3]) commit(dir, { [`src/f${i}.js`]: `${i}\n` }, `w${i}`);
  commit(dir, { '.coding-flow/config.json': configWith(dir, { baseBranch: 'trunk' }) }, 'trunk is the base');

  const diffBase = JSON.parse(run(dir, ['harness', 'check', '--json']).output).diffBase;
  assert.equal(diffBase.source, 'config');
  assert.equal(diffBase.ref, 'trunk');
  assert.equal(diffBase.configIgnored, undefined);
  assert.equal(run(dir, ['verify', '--no-cache', '--base', 'HEAD']).code, 0);
});

test('a fork point naming the branch itself is ignored and named', (t) => {
  const dir = epicRepo(t);
  git(dir, ['switch', '-c', 'story-07-01-geo']);
  commit(dir, { 'src/geo/a.ts': 'export const g = 1;\n' }, 'story work');
  git(dir, ['config', 'branch.story-07-01-geo.codingFlowBase', 'story-07-01-geo']);

  const diffBase = JSON.parse(run(dir, ['harness', 'check', '--json']).output).diffBase;
  assert.equal(diffBase.ref, 'feature/EPIC-07-x');
  assert.equal(diffBase.forkPointIgnored.value, 'story-07-01-geo');
});

// A branch already contained in its base has nothing of its own: the empty
// diff is the truth, whatever the base's config history says.
test('a fresh story on develop keeps develop as its base, though the config once said main', (t) => {
  const dir = epicRepo(t);
  git(dir, ['switch', 'main']);
  commit(dir, { '.coding-flow/config.json': configWith(dir, { baseBranch: 'main' }) }, 'main is the base');
  git(dir, ['switch', '-c', 'develop']);
  commit(dir, { '.coding-flow/config.json': configWith(dir, { baseBranch: 'develop' }) }, 'develop is the base');
  for (const i of [1, 2]) commit(dir, { [`src/d${i}.js`]: `${i}\n` }, `d${i}`);
  git(dir, ['switch', '-c', 'story-07-03-fresh']);
  git(dir, ['config', 'branch.story-07-03-fresh.codingFlowBase', 'develop']);

  const diffBase = JSON.parse(run(dir, ['harness', 'check', '--json']).output).diffBase;
  assert.equal(diffBase.ref, 'develop');
  assert.equal(diffBase.source, 'config');
  assert.equal(diffBase.configIgnored, undefined);
  assert.equal(run(dir, ['verify', '--no-cache', '--base', 'HEAD']).code, 0);
});

test('a story contained in the configured trunk (fresh, or landed) is measured from trunk', (t) => {
  const dir = epicRepo(t);
  git(dir, ['switch', '-c', 'trunk', 'main']);
  commit(dir, { '.coding-flow/config.json': configWith(dir, { baseBranch: 'trunk' }) }, 'trunk is the base');
  for (const i of [1, 2, 3]) commit(dir, { [`src/t${i}.js`]: `${i}\n` }, `t${i}`);
  git(dir, ['switch', '-c', 'story-07-04-x']);

  const fresh = JSON.parse(run(dir, ['harness', 'check', '--json']).output).diffBase;
  assert.equal(fresh.ref, 'trunk');
  assert.equal(fresh.source, 'config');
  assert.equal(fresh.configIgnored, undefined);

  commit(dir, { 'src/s.js': 's\n' }, 'own');
  git(dir, ['switch', 'trunk']);
  git(dir, ['merge', '-q', '--ff-only', 'story-07-04-x']);
  git(dir, ['switch', 'story-07-04-x']);
  git(dir, ['config', 'branch.story-07-04-x.codingFlowBase', 'trunk']);
  const landed = JSON.parse(run(dir, ['harness', 'check', '--json']).output).diffBase;
  assert.equal(landed.ref, 'trunk');
  assert.equal(landed.source, 'config');
  assert.equal(landed.configIgnored, undefined);
});

test('--base HEAD on a detached checkout ahead of its base is refused, naming the checkout', (t) => {
  const dir = epicRepo(t);
  git(dir, ['switch', '-c', 'develop', 'main']);
  commit(dir, { 'src/a.ts': 'export const a = 1;\n' }, 'develop work');
  git(dir, ['checkout', '-q', '--detach']);
  commit(dir, { 'src/b.ts': 'export const b = 1;\n' }, 'detached work');

  const refused = run(dir, ['verify', '--no-cache', '--base', 'HEAD']);
  assert.notEqual(refused.code, 0);
  assert.match(refused.output, /this checkout has 1 commit\(s\) of its own since develop/);
});
