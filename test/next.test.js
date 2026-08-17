'use strict';

// Contract tests for `ai-flow next`: it ranks the same state `status` reads into
// one prioritized suggestion. Read-only, so every test just sets up story files
// and (sometimes) verify evidence, then asserts on what `next` says to do.

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

function initRepo(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-next-'));
  const repo = path.join(base, 'repo');
  fs.mkdirSync(repo);
  sh(repo, 'git', ['-c', 'init.defaultBranch=main', 'init']);
  sh(repo, 'git', ['config', 'user.email', 'test@example.com']);
  sh(repo, 'git', ['config', 'user.name', 'Test']);
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  return { base, repo };
}

function writeStory(repo, epicName, storyName, body) {
  const dir = path.join(repo, 'epics', epicName, storyName);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'story.md'), body);
  return path.posix.join('epics', epicName, storyName);
}

function writeVerify(repo, storyPath, { ok = true, id = '1' } = {}) {
  const dir = path.join(repo, '.coding-flow', 'runs');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${id}-verify.json`),
    JSON.stringify({ generatedAt: new Date().toISOString(), story: storyPath, ok, commandsFound: 1, results: [] }),
  );
}

function commitAll(repo, message) {
  sh(repo, 'git', ['add', '-A']);
  sh(repo, 'git', ['commit', '-m', message]);
}

test('next says there is nothing waiting on an empty project', (t) => {
  const { repo } = initRepo(t);
  fs.writeFileSync(path.join(repo, 'README.md'), '# repo\n');
  commitAll(repo, 'init');

  const { code, output } = run(repo, ['next']);
  assert.equal(code, 0);
  assert.match(output, /nothing waiting/i);
});

test('next surfaces a blocked story first, even with other stories waiting', (t) => {
  const { repo } = initRepo(t);
  writeStory(repo, 'epic-01-x', 'story-01-01-blocked', '# blocked\n\n## Status: blocked\nfailed\n');
  writeStory(repo, 'epic-01-x', 'story-01-02-planned', '# planned\n\nnothing yet\n');
  commitAll(repo, 'init');

  const { code, output } = run(repo, ['next']);
  assert.equal(code, 0);
  assert.match(output, /\[blocked\]/);
  assert.match(output, /story-01-01-blocked/);
});

test('next flags a story marked done with no captured verify as unproven', (t) => {
  const { repo } = initRepo(t);
  writeStory(repo, 'epic-01-x', 'story-01-01-a', '# a\n\n## Status: done\n');
  commitAll(repo, 'init');

  const { code, output } = run(repo, ['next']);
  assert.equal(code, 0);
  assert.match(output, /\[unproven\]/);
  assert.match(output, /written status is not proof/);
  assert.match(output, /ai-flow verify --story epics\/epic-01-x\/story-01-01-a/);
});

test('next flags a story marked done whose last captured verify failed', (t) => {
  const { repo } = initRepo(t);
  const storyPath = writeStory(repo, 'epic-01-x', 'story-01-01-a', '# a\n\n## Status: done\n');
  writeVerify(repo, storyPath, { ok: false });
  commitAll(repo, 'init');

  const { code, output } = run(repo, ['next']);
  assert.equal(code, 0);
  assert.match(output, /\[unproven\]/);
  assert.match(output, /last captured verify failed/);
});

test('next suggests worktree add for a planned story with no worktree', (t) => {
  const { repo } = initRepo(t);
  const storyPath = writeStory(repo, 'epic-01-x', 'story-01-01-a', '# a\n\nnot started\n');
  commitAll(repo, 'init');

  const { code, output } = run(repo, ['next']);
  assert.equal(code, 0);
  assert.match(output, /\[planned\]/);
  assert.match(output, new RegExp(`ai-flow worktree add --story ${storyPath}`));
});

test('next suggests ship for a proven story with unshipped work on the checked-out branch', (t) => {
  const { repo } = initRepo(t);
  const storyPath = writeStory(repo, 'epic-01-x', 'story-01-01-a', '# a\n\n## Status: done\n');
  writeVerify(repo, storyPath, { ok: true });
  commitAll(repo, 'init');

  sh(repo, 'git', ['checkout', '-b', 'story-01-01-a']);
  fs.writeFileSync(path.join(repo, 'work.txt'), 'work\n');
  sh(repo, 'git', ['add', '.']);
  sh(repo, 'git', ['commit', '-m', 'implement']);

  const { code, output } = run(repo, ['next']);
  assert.equal(code, 0);
  assert.match(output, /\[ready-to-ship\]/);
  assert.match(output, /ai-flow ship/);
});

test('next has nothing to say once the proven branch has no unshipped commits', (t) => {
  const { repo } = initRepo(t);
  const storyPath = writeStory(repo, 'epic-01-x', 'story-01-01-a', '# a\n\n## Status: done\n');
  writeVerify(repo, storyPath, { ok: true });
  commitAll(repo, 'init');

  sh(repo, 'git', ['checkout', '-b', 'story-01-01-a']);
  // No new commit: the branch is identical to main, nothing for ship to do.

  const { code, output } = run(repo, ['next']);
  assert.equal(code, 0);
  assert.match(output, /nothing waiting/i);
});

test('next --all lists every item ranked by tier', (t) => {
  const { repo } = initRepo(t);
  writeStory(repo, 'epic-01-x', 'story-01-01-blocked', '# blocked\n\n## Status: blocked\nfailed\n');
  writeStory(repo, 'epic-01-x', 'story-01-02-planned', '# planned\n\nnothing yet\n');
  commitAll(repo, 'init');

  const { code, output } = run(repo, ['next', '--all']);
  assert.equal(code, 0);
  assert.match(output, /Next queue \(2 item\(s\)\)/);
  const blockedIndex = output.indexOf('[blocked]');
  const plannedIndex = output.indexOf('[planned]');
  assert.ok(blockedIndex >= 0 && plannedIndex >= 0 && blockedIndex < plannedIndex, 'blocked must rank before planned');
});

test('next --json emits only the top item by default, all with --all', (t) => {
  const { repo } = initRepo(t);
  writeStory(repo, 'epic-01-x', 'story-01-01-blocked', '# blocked\n\n## Status: blocked\nfailed\n');
  writeStory(repo, 'epic-01-x', 'story-01-02-planned', '# planned\n\nnothing yet\n');
  commitAll(repo, 'init');

  const top = JSON.parse(run(repo, ['next', '--json']).output);
  assert.equal(top.items.length, 1);
  assert.equal(top.items[0].tier, 1);

  const all = JSON.parse(run(repo, ['next', '--all', '--json']).output);
  assert.equal(all.items.length, 2);
});
