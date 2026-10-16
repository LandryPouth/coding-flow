'use strict';

// The scope a verdict was measured on is printed where the verdict is read:
// verify, status (when it is not "story"), the PR evidence block; and doctor
// warns when the default base would silently be a guessed "main".
// Throwaway repositories, observable output only.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildEvidenceBlock } = require('../bin/lib/ship');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');
const STORY = 'epics/epic-07-x/story-07-03-x';

function run(cwd, args) {
  try {
    const output = execFileSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, output };
  } catch (err) {
    return { code: err.status ?? 1, output: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function repo(t, branch) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-scopeline-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(run(dir, ['init']).code, 0);
  git(dir, ['init', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);

  const configPath = path.join(dir, '.coding-flow', 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.validation = { commands: ['node -e "process.exit(0)"'], quality: [] };
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

  fs.writeFileSync(path.join(dir, 'README.md'), '# x\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'init']);
  git(dir, ['switch', '-qc', branch]);

  fs.mkdirSync(path.join(dir, STORY), { recursive: true });
  fs.writeFileSync(path.join(dir, STORY, 'story.md'), '# X\n\nCopy tweak.\n');
  fs.writeFileSync(path.join(dir, 'a.md'), 'a\n');
  git(dir, ['add', '-A', '-f']);
  git(dir, ['commit', '-qm', 'work']);
  return dir;
}

test('verify prints the scope, base, source and file count', (t) => {
  const dir = repo(t, 'story-07-03-x');
  fs.mkdirSync(path.join(dir, 'src', 'payments'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'payments', 'charge.js'), 'exports.c = 1;\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'risky']);
  const out = run(dir, ['verify', '--no-cache', '--story', STORY]).output;

  assert.match(out, /^Scope: story — diff against main \(default branch\), \d+ files?$/m);
});

test('verify does not claim a file count when the coverage gate was skipped', (t) => {
  const dir = repo(t, 'story-07-03-x');
  const out = run(dir, ['verify', '--no-cache', '--story', STORY]).output;

  assert.match(out, /^Scope: story — diff against main \(default branch\)$/m);
});

test('status shows the scope next to the coverage state only when it is not "story"', (t) => {
  const epic = repo(t, 'epic-07-x');
  run(epic, ['verify', '--no-cache', '--story', STORY]);
  assert.match(run(epic, ['status']).output, /story-07-03-x\s.*coverage \S+ \(epic scope\)/);

  const own = repo(t, 'story-07-03-x');
  run(own, ['verify', '--no-cache', '--story', STORY]);
  assert.doesNotMatch(run(own, ['status']).output, /scope\)/);
});

test('the PR evidence block carries the scope line', () => {
  const block = buildEvidenceBlock({
    ok: true,
    results: [],
    diffBase: { ref: 'feature/EPIC-32-geo', mergeBase: 'abc', source: 'fork-point', scope: 'story' },
    coverage: { required: true, changedFiles: ['a.js', 'b.js'] },
  });

  assert.match(block, /\*\*Scope:\*\* story — diff against feature\/EPIC-32-geo \(fork point\), 2 files/);
});

test('doctor warns when a remote exists but origin/HEAD does not', (t) => {
  const dir = repo(t, 'story-07-03-x');
  const has = () => (JSON.parse(run(dir, ['doctor', '--json']).output).warnings || []).some((w) => w.code === 'origin_head_missing');

  assert.equal(has(), false, 'no remote, nothing to warn about');

  git(dir, ['remote', 'add', 'origin', dir]);
  assert.equal(has(), true);

  git(dir, ['fetch', '-q', 'origin']);
  git(dir, ['remote', 'set-head', 'origin', 'main']);
  assert.equal(has(), false, 'set-head clears it');
});
