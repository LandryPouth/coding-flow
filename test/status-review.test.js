'use strict';

// Contract tests for story-04-01: `ai-flow status` surfaces a `review` field
// per story — "pass" (fresh), "stale" (evidence exists, tree moved since),
// "fail", or "none" (no evidence ever captured) — read from `latestReviewByStoryDir`
// (audit.js) the same way `landReady` already reads verify freshness, but for
// every story (not gated on a linked worktree the way `landReady` is).

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
  execFileSync('git', args, { cwd, stdio: ['ignore', 'ignore', 'ignore'] });
}

function initGitRepo(dir) {
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
}

function repoWithStory(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-status-review-'));
  const repo = path.join(base, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  const storyRel = 'epics/epic-01-x/story-01-01-y';
  fs.mkdirSync(path.join(repo, storyRel), { recursive: true });
  fs.writeFileSync(path.join(repo, storyRel, 'story.md'), '# Story 01.01\n');

  initGitRepo(repo);
  assert.equal(run(repo, ['init']).code, 0);
  fs.writeFileSync(path.join(repo, '.gitignore'), '.coding-flow/runs/\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'base']);

  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  return { repo, storyRel };
}

function storyOf(dir, storyRel) {
  const { code, output } = run(dir, ['status', '--json']);
  assert.equal(code, 0, `status --json must exit 0 (${output})`);
  const data = JSON.parse(output);
  for (const epic of data.epics) {
    for (const story of epic.stories) {
      if (story.path === storyRel) return story;
    }
  }
  throw new Error(`story ${storyRel} not found in status output`);
}

test('a story with no review ever captured reports review: "none"', (t) => {
  const { repo, storyRel } = repoWithStory(t);
  assert.equal(storyOf(repo, storyRel).review, 'none');
});

test('a fresh passing review reports review: "pass"', (t) => {
  const { repo, storyRel } = repoWithStory(t);
  assert.equal(run(repo, ['review', 'capture', '--story', storyRel, '--verdict', 'pass']).code, 0);
  assert.equal(storyOf(repo, storyRel).review, 'pass');
});

test('a failing review reports review: "fail", distinct from stale and none', (t) => {
  const { repo, storyRel } = repoWithStory(t);
  run(repo, ['review', 'capture', '--story', storyRel, '--verdict', 'fail']);
  assert.equal(storyOf(repo, storyRel).review, 'fail');
});

test('a passing review made stale by a later commit reports review: "stale"', (t) => {
  const { repo, storyRel } = repoWithStory(t);
  assert.equal(run(repo, ['review', 'capture', '--story', storyRel, '--verdict', 'pass']).code, 0);
  assert.equal(storyOf(repo, storyRel).review, 'pass');

  fs.writeFileSync(path.join(repo, storyRel, 'story.md'), '# Story 01.01\n\nchanged after review\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'edit after review']);

  assert.equal(storyOf(repo, storyRel).review, 'stale');
});

test('the text output shows the review state next to the story line, only when not "none"', (t) => {
  const { repo, storyRel } = repoWithStory(t);

  const before = run(repo, ['status']).output;
  assert.doesNotMatch(before, /review: /, 'a never-reviewed story must not print a review suffix');

  assert.equal(run(repo, ['review', 'capture', '--story', storyRel, '--verdict', 'pass']).code, 0);
  const after = run(repo, ['status']).output;
  assert.match(after, /review: pass/);
});

test('status --json review field is independent of a linked worktree existing', (t) => {
  const { repo, storyRel } = repoWithStory(t);
  assert.equal(run(repo, ['review', 'capture', '--story', storyRel, '--verdict', 'pass']).code, 0);

  const story = storyOf(repo, storyRel);
  assert.equal(story.worktree, null, 'this story has no linked worktree');
  assert.equal(story.review, 'pass', 'review must still be reported without a worktree');
});

// story-04-02: `reviewRequired` names whether THIS story's own risk tier is
// STRICT (the same `combineRisk` computation `chainIsFinished`/`next`'s
// tier-4 check gate on) — only meaningful once a story claims to be done.
test('status --json reports reviewRequired: true for a done STRICT-tier story (diff touches a high-risk path), and it is absent for a story that has not claimed done', (t) => {
  const { repo, storyRel } = repoWithStory(t);

  const notDone = storyOf(repo, storyRel);
  assert.equal(notDone.reviewRequired, undefined, 'a story that has not claimed done has no reviewRequired opinion yet');

  // `changedFilesForCoverage` reads the diff since the base branch — a
  // separate branch is required for that diff to be non-empty, the same
  // "one branch per epic" shape real usage (and `next.test.js`'s own STRICT
  // fixture) already has, never directly on the base branch itself.
  git(repo, ['branch', '-M', 'main']);
  git(repo, ['checkout', '-b', 'work']);
  fs.appendFileSync(path.join(repo, storyRel, 'story.md'), '\n## Status: done\n');
  fs.writeFileSync(path.join(repo, 'payment.js'), 'module.exports = {};\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'mark done, touch a high-risk path']);

  const story = storyOf(repo, storyRel);
  assert.equal(story.reviewRequired, true, 'a high-risk-path diff must resolve this STRICT-tier story to reviewRequired: true');
  assert.equal(story.review, 'none', 'no review has been captured for it yet');
});

test('status --json reports reviewRequired: false for a done story whose diff never touched a high-risk path', (t) => {
  const { repo, storyRel } = repoWithStory(t);

  git(repo, ['branch', '-M', 'main']);
  git(repo, ['checkout', '-b', 'work']);
  fs.appendFileSync(path.join(repo, storyRel, 'story.md'), '\n## Status: done\n');
  fs.writeFileSync(path.join(repo, 'notes.txt'), 'plain change\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'mark done, plain change']);

  const story = storyOf(repo, storyRel);
  assert.equal(story.reviewRequired, false, 'a non-risky diff must not resolve this story to STRICT');
});
