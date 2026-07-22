'use strict';

// Contract tests for the worktree <-> story integration.
// `worktree add --story <dir>` names the branch after the story directory;
// `status` then links the story to its worktree (stateless mapping). We verify
// this coupling end-to-end on a real throwaway git repo.

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

// Throwaway git repo in a repo/ subdirectory (so that ../repo-worktrees has a
// writable parent), with a story ready to be linked.
function repoWithStory(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-status-'));
  const repo = path.join(base, 'repo');
  const storyRel = 'epics/epic-03-kyc/story-03-01-kyc-upload';
  fs.mkdirSync(path.join(repo, storyRel), { recursive: true });
  fs.writeFileSync(path.join(repo, storyRel, 'story.md'), '# Story 03.01 - KYC upload\n');
  sh(repo, 'git', ['-c', 'init.defaultBranch=main', 'init']);
  sh(repo, 'git', ['config', 'user.email', 'test@example.com']);
  sh(repo, 'git', ['config', 'user.name', 'Test']);
  sh(repo, 'git', ['add', '.']);
  sh(repo, 'git', ['commit', '-m', 'init']);
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  return { base, repo, storyRel, storyName: 'story-03-01-kyc-upload' };
}

function statusJson(cwd) {
  const { code, output } = run(cwd, ['status', '--json']);
  assert.equal(code, 0, `status --json must exit 0 (${output})`);
  return JSON.parse(output);
}

test('worktree add --story names the branch after the story directory', (t) => {
  const { base, repo, storyRel, storyName } = repoWithStory(t);
  const { code } = run(repo, ['worktree', 'add', '--story', storyRel]);
  assert.equal(code, 0, 'add --story must succeed');

  assert.ok(
    fs.existsSync(path.join(base, 'repo-worktrees', storyName)),
    'the worktree must take the name of the story directory',
  );
  const branches = sh(repo, 'git', ['branch', '--list', storyName]);
  assert.ok(branches.includes(storyName), 'the branch must carry the story name');
});

test('status links the story to its worktree', (t) => {
  const { repo, storyRel } = repoWithStory(t);
  run(repo, ['worktree', 'add', '--story', storyRel]);

  const data = statusJson(repo);
  const story = data.epics[0].stories[0];
  assert.ok(story.worktree, 'the story must expose its worktree path');
  assert.ok(story.worktree.includes('story-03-01-kyc-upload'), 'the worktree points to the right directory');
});

test('status lists the worktrees without a story in the "loose" section', (t) => {
  const { repo } = repoWithStory(t);
  run(repo, ['worktree', 'add', 'feat-loose']);

  const data = statusJson(repo);
  const loose = data.worktrees.loose.map((entry) => entry.branch);
  assert.ok(loose.includes('feat-loose'), 'a loose branch must appear as a story-less worktree');
});

test('status does not crash outside a git repo', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-status-nogit-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'epics', 'epic-01-x', 'story-01-01-y'), { recursive: true });

  const data = statusJson(dir);
  assert.equal(data.epics[0].stories[0].worktree, null, 'without git, no story is linked to a worktree');
  assert.equal(data.worktrees.active, false, 'the worktrees block must report active:false outside a repo');
});

test('worktree add --story refuses a non-existent story directory', (t) => {
  const { repo } = repoWithStory(t);
  const { code } = run(repo, ['worktree', 'add', '--story', 'epics/epic-99/story-99-99-ghost']);
  assert.notEqual(code, 0, 'a non-existent story must fail add');
});
