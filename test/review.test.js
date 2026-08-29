'use strict';

// Contract tests for story-04-01: `ai-flow review capture` writes a
// /flow-review verdict as durable evidence under .coding-flow/runs/ (the
// same directory verify evidence already lives in), and `latestReviewByStoryDir`
// (bin/lib/audit.js) reads it back per story directory — mirroring
// `latestVerifyByStoryDir` exactly in shape and multi-run handling.

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

// A git project with one story, `ai-flow init`-ed so `.coding-flow/` exists
// (review capture resolves the project root off that marker, same as every
// other command — context.js's `findProjectRoot`).
function repoWithStory(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-review-'));
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

function runsDir(repo) {
  return path.join(repo, '.coding-flow', 'runs');
}

function reviewFiles(repo) {
  const dir = runsDir(repo);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => name.endsWith('-review.json'));
}

test('review capture with verdict pass writes evidence with ok:true, the story path, and the current tree token', (t) => {
  const { repo, storyRel } = repoWithStory(t);

  const { code, output } = run(repo, ['review', 'capture', '--story', storyRel, '--verdict', 'pass']);
  assert.equal(code, 0, `capture must exit 0 on a pass verdict: ${output}`);

  const files = reviewFiles(repo);
  assert.equal(files.length, 1, 'exactly one review evidence file must be written');

  const evidence = JSON.parse(fs.readFileSync(path.join(runsDir(repo), files[0]), 'utf8'));
  assert.equal(evidence.ok, true);
  assert.equal(evidence.verdict, 'pass');
  assert.equal(evidence.story, storyRel);
  assert.ok(evidence.provenance && evidence.provenance.git && evidence.provenance.git.treeToken, 'provenance.git.treeToken must be captured');
});

test('review capture with verdict fail records ok:false', (t) => {
  const { repo, storyRel } = repoWithStory(t);

  // A fail verdict is not a tool error: the command still exits non-zero
  // (mirroring harnessEvidence's own exitCode=1 on a failing check) but the
  // evidence is captured regardless.
  const { code } = run(repo, ['review', 'capture', '--story', storyRel, '--verdict', 'fail']);
  assert.notEqual(code, 0, 'capture must signal the fail verdict via a non-zero exit');

  const files = reviewFiles(repo);
  assert.equal(files.length, 1);
  const evidence = JSON.parse(fs.readFileSync(path.join(runsDir(repo), files[0]), 'utf8'));
  assert.equal(evidence.ok, false);
  assert.equal(evidence.verdict, 'fail');
});

test('review rejects a missing or unknown subcommand ("capture" is the only one)', (t) => {
  const { repo } = repoWithStory(t);

  assert.notEqual(run(repo, ['review']).code, 0);
  assert.notEqual(run(repo, ['review', 'bogus']).code, 0);
  assert.equal(reviewFiles(repo).length, 0, 'no evidence must be written for an unknown subcommand');
});

test('review capture rejects a missing or invalid --verdict', (t) => {
  const { repo, storyRel } = repoWithStory(t);

  assert.notEqual(run(repo, ['review', 'capture', '--story', storyRel]).code, 0);
  assert.notEqual(run(repo, ['review', 'capture', '--story', storyRel, '--verdict', 'maybe']).code, 0);
  assert.equal(reviewFiles(repo).length, 0, 'no evidence must be written for a rejected capture');
});

test('review capture rejects a --story that is not a story directory', (t) => {
  const { repo } = repoWithStory(t);
  const { code } = run(repo, ['review', 'capture', '--story', 'does/not/exist', '--verdict', 'pass']);
  assert.notEqual(code, 0);
});

test('review capture rejects a --story outside epics/ (and specs/), the same scope verify enforces', (t) => {
  const { repo } = repoWithStory(t);

  // "." resolves and exists (resolveStoryDir alone would accept it), but is
  // not a story directory — the same mistake `verify --story .` already
  // refuses via requireStoryScope. Without that guard this would silently
  // write evidence keyed to `story: ""`, unfindable by any later
  // latestReviewByStoryDir lookup.
  const { code } = run(repo, ['review', 'capture', '--story', '.', '--verdict', 'pass']);
  assert.notEqual(code, 0, '--story "." must be rejected, not silently accepted as an empty story path');
  assert.equal(reviewFiles(repo).length, 0, 'no evidence must be written for a rejected --story scope');
});

test('review capture records the requested dimensions, finding counts, and reviewer', (t) => {
  const { repo, storyRel } = repoWithStory(t);

  const { code } = run(repo, [
    'review', 'capture', '--story', storyRel, '--verdict', 'fail', '--reviewer', 'subagent',
    '--architecture', 'deep', '--tests', 'deep', '--security', 'quick', '--quality', 'skipped', '--e2e', 'skipped',
    '--p0', '1', '--p1', '2', '--p2', '0', '--p3', '3',
  ]);
  assert.notEqual(code, 0);

  const files = reviewFiles(repo);
  const evidence = JSON.parse(fs.readFileSync(path.join(runsDir(repo), files[0]), 'utf8'));
  assert.deepEqual(evidence.dimensions, {
    architecture: 'deep', tests: 'deep', security: 'quick', quality: 'skipped', e2e: 'skipped',
  });
  assert.deepEqual(evidence.findingCounts, { p0: 1, p1: 2, p2: 0, p3: 3 });
  assert.equal(evidence.reviewer, 'subagent');
});

test('latestReviewByStoryDir returns only the latest capture by generatedAt when two exist for the same story', (t) => {
  const { repo, storyRel } = repoWithStory(t);

  assert.equal(run(repo, ['review', 'capture', '--story', storyRel, '--verdict', 'fail']).code === 0, false);
  // Force distinct filenames/timestamps the same way a human retry would:
  // two captures milliseconds apart still get distinct -review.json names
  // (writeReviewEvidence's own counter), so this does not need a real sleep.
  assert.equal(run(repo, ['review', 'capture', '--story', storyRel, '--verdict', 'pass']).code, 0);

  assert.equal(reviewFiles(repo).length, 2, 'both captures must be recorded as separate files');

  const { latestReviewByStoryDir } = require('../bin/lib/audit');
  const entry = latestReviewByStoryDir(repo).get(storyRel);
  assert.ok(entry, 'an entry must exist for the story');
  assert.equal(entry.ok, true, 'the latest (second, pass) capture must win over the earlier fail');
});

test('a story with no review ever captured has no entry in latestReviewByStoryDir', (t) => {
  const { repo, storyRel } = repoWithStory(t);
  const { latestReviewByStoryDir } = require('../bin/lib/audit');
  assert.equal(latestReviewByStoryDir(repo).get(storyRel), undefined);
});

test('a review entry for a different tree token than the current one is stale per audit.js\'s own isStale', (t) => {
  const { repo, storyRel } = repoWithStory(t);
  assert.equal(run(repo, ['review', 'capture', '--story', storyRel, '--verdict', 'pass']).code, 0);

  const { latestReviewByStoryDir, isStale } = require('../bin/lib/audit');
  const { currentTreeToken } = require('../bin/lib/identity');

  const entryBefore = latestReviewByStoryDir(repo).get(storyRel);
  assert.equal(isStale(entryBefore, currentTreeToken(repo)), false, 'must not be stale right after capture');

  // A real commit touching source outside .coding-flow/, same as the
  // existing landReady staleness tests.
  fs.writeFileSync(path.join(repo, storyRel, 'story.md'), '# Story 01.01\n\nchanged after review\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'edit after review']);

  const entryAfter = latestReviewByStoryDir(repo).get(storyRel);
  assert.equal(isStale(entryAfter, currentTreeToken(repo)), true, 'must be stale once the tree moved since capture');
});
