'use strict';

// Story 19-09: a failed review is cleared by a new review round, not by a
// green verify. `review capture --verdict pass` right after a `fail` needs
// `--round <failed round + 1>` (or `--accept "<reason>"`); a STRICT story
// needs two consecutive passing rounds after a fail before `status` calls its
// review clean.

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

function repoWithStory(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-review-rounds-'));
  const repo = path.join(base, 'repo');
  const storyRel = 'epics/epic-01-x/story-01-01-y';
  fs.mkdirSync(path.join(repo, storyRel), { recursive: true });
  fs.writeFileSync(path.join(repo, storyRel, 'story.md'), '# Story 01.01\n');
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.email', 'test@example.com']);
  git(repo, ['config', 'user.name', 'Test']);
  git(repo, ['config', 'commit.gpgsign', 'false']);
  assert.equal(run(repo, ['init']).code, 0);
  fs.writeFileSync(path.join(repo, '.gitignore'), '.coding-flow/runs/\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'base']);
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  return { repo, storyRel };
}

// The same STRICT shape status-review.test.js uses: a done story on a work
// branch whose diff touches a high-risk path.
function strictDoneStory(repo, storyRel) {
  git(repo, ['branch', '-M', 'main']);
  git(repo, ['checkout', '-q', '-b', 'work']);
  fs.appendFileSync(path.join(repo, storyRel, 'story.md'), '\n## Status: done\n');
  fs.writeFileSync(path.join(repo, 'payment.js'), 'module.exports = {};\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'mark done, touch a high-risk path']);
}

function standardDoneStory(repo, storyRel) {
  git(repo, ['branch', '-M', 'main']);
  git(repo, ['checkout', '-q', '-b', 'work']);
  fs.appendFileSync(path.join(repo, storyRel, 'story.md'), '\n## Status: done\n');
  fs.writeFileSync(path.join(repo, 'notes.txt'), 'plain change\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'mark done, plain change']);
}

function reviewFiles(repo) {
  const dir = path.join(repo, '.coding-flow', 'runs');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => name.endsWith('-review.json')).sort();
}

function readReview(repo, name) {
  return JSON.parse(fs.readFileSync(path.join(repo, '.coding-flow', 'runs', name), 'utf8'));
}

function storyOf(repo, storyRel) {
  const { code, output } = run(repo, ['status', '--json']);
  assert.equal(code, 0, output);
  for (const epic of JSON.parse(output).epics) {
    for (const story of epic.stories) {
      if (story.path === storyRel) return story;
    }
  }
  throw new Error(`story ${storyRel} not found`);
}

function capture(repo, storyRel, ...extra) {
  return run(repo, ['review', 'capture', '--story', storyRel, ...extra]);
}

test('a pass right after a failed review, without a new round, is refused and writes nothing', (t) => {
  const { repo, storyRel } = repoWithStory(t);
  capture(repo, storyRel, '--verdict', 'fail', '--p1', '2');
  const before = reviewFiles(repo);

  const res = capture(repo, storyRel, '--verdict', 'pass');
  assert.notEqual(res.code, 0, res.output);
  assert.match(res.output, /a failed review is cleared by a new review of the whole diff, not by verify alone/);
  assert.match(res.output, /ai-flow review capture --story epics\/epic-01-x\/story-01-01-y --verdict pass --round 2/);
  assert.deepEqual(reviewFiles(repo), before, 'a refused capture writes no evidence');
  assert.equal(storyOf(repo, storyRel).review, 'fail');
});

test('a pass declared as the next round is captured with its round and the failed review it clears', (t) => {
  const { repo, storyRel } = repoWithStory(t);
  capture(repo, storyRel, '--verdict', 'fail', '--p1', '1');
  const [failed] = reviewFiles(repo);

  const res = capture(repo, storyRel, '--verdict', 'pass', '--round', '2');
  assert.equal(res.code, 0, res.output);
  const passed = reviewFiles(repo).find((name) => name !== failed);
  const evidence = readReview(repo, passed);
  assert.equal(evidence.round, 2);
  assert.equal(evidence.after, `.coding-flow/runs/${failed}`);
  assert.equal(readReview(repo, failed).round, 1, 'the first review of a story is round 1');

  const story = storyOf(repo, storyRel);
  assert.equal(story.review, 'pass');
  assert.equal(story.reviewRound, 2);
  assert.equal(story.reviewAfter, `.coding-flow/runs/${failed}`);
});

test('a round that skips a number is refused', (t) => {
  const { repo, storyRel } = repoWithStory(t);
  capture(repo, storyRel, '--verdict', 'fail', '--p1', '1');
  const before = reviewFiles(repo);

  const res = capture(repo, storyRel, '--verdict', 'pass', '--round', '3');
  assert.notEqual(res.code, 0, res.output);
  assert.match(res.output, /--round 3 .*round 2/);
  assert.deepEqual(reviewFiles(repo), before);
});

test('a STRICT story needs two consecutive passing rounds after a fail; a fail in between restarts the count', (t) => {
  const { repo, storyRel } = repoWithStory(t);
  strictDoneStory(repo, storyRel);

  assert.equal(capture(repo, storyRel, '--verdict', 'fail', '--p1', '1').code, 1);
  assert.equal(capture(repo, storyRel, '--verdict', 'pass', '--round', '2').code, 0);
  let story = storyOf(repo, storyRel);
  assert.equal(story.reviewRequired, true);
  assert.equal(story.review, 'confirming', 'one clean round after a fail is not enough for STRICT');
  assert.match(run(repo, ['status']).output, /review: pass — one more round required \(STRICT\)/);

  assert.equal(capture(repo, storyRel, '--verdict', 'fail', '--p1', '1', '--round', '3').code, 1);
  assert.equal(capture(repo, storyRel, '--verdict', 'pass', '--round', '4').code, 0);
  assert.equal(storyOf(repo, storyRel).review, 'confirming', 'a fail in between restarts the count');

  assert.equal(capture(repo, storyRel, '--verdict', 'pass', '--round', '5').code, 0);
  story = storyOf(repo, storyRel);
  assert.equal(story.review, 'pass');
  assert.doesNotMatch(run(repo, ['status']).output, /one more round required/);
});

test('a STANDARD story is clean after one passing round following a fail', (t) => {
  const { repo, storyRel } = repoWithStory(t);
  standardDoneStory(repo, storyRel);
  capture(repo, storyRel, '--verdict', 'fail', '--p1', '1');
  assert.equal(capture(repo, storyRel, '--verdict', 'pass', '--round', '2').code, 0);
  assert.equal(storyOf(repo, storyRel).review, 'pass');
});

test('with no failed review, a pass needs no new flag, and each capture is the next round', (t) => {
  const { repo, storyRel } = repoWithStory(t);
  assert.equal(capture(repo, storyRel, '--verdict', 'pass').code, 0);
  assert.equal(capture(repo, storyRel, '--verdict', 'pass').code, 0);
  const rounds = reviewFiles(repo).map((name) => readReview(repo, name).round);
  assert.deepEqual(rounds, [1, 2]);
  assert.equal(storyOf(repo, storyRel).review, 'pass');
});

test('--accept captures a pass after a fail without a round, and stores the reason', (t) => {
  const { repo, storyRel } = repoWithStory(t);
  capture(repo, storyRel, '--verdict', 'fail', '--p1', '1');
  const [failed] = reviewFiles(repo);

  const res = capture(repo, storyRel, '--verdict', 'pass', '--accept', 'the maintainer read the fix');
  assert.equal(res.code, 0, res.output);
  const evidence = readReview(repo, reviewFiles(repo).find((name) => name !== failed));
  assert.equal(evidence.acceptedRisk, 'the maintainer read the fix');
  assert.equal(evidence.after, `.coding-flow/runs/${failed}`);
});
