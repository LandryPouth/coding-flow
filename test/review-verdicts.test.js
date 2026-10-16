'use strict';

// Contract tests for story-08-04: a captured "pass" with an open P0/P1 needs a
// written acceptance; status says when a STRICT story was reviewed only by its
// author; audit counts reviews by reviewer kind and lists the accepted passes.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');
const STORY = 'epics/epic-01-x/story-01-01-y';

function run(cwd, args) {
  try {
    const output = execFileSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, output };
  } catch (err) {
    return { code: err.status ?? 1, output: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'ignore', 'ignore'] });
}

function repo(t, { strict = false } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-review-verdicts-'));
  const dir = path.join(base, 'repo');
  fs.mkdirSync(path.join(dir, STORY), { recursive: true });
  fs.writeFileSync(path.join(dir, STORY, 'story.md'), '# Story 01.01\n');
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 't@example.com']);
  git(dir, ['config', 'user.name', 'T']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  assert.equal(run(dir, ['init']).code, 0);
  fs.writeFileSync(path.join(dir, '.gitignore'), '.coding-flow/runs/\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'base']);

  if (strict) {
    git(dir, ['branch', '-M', 'main']);
    git(dir, ['checkout', '-b', 'work']);
    fs.appendFileSync(path.join(dir, STORY, 'story.md'), '\n## Status: done\n');
    fs.writeFileSync(path.join(dir, 'payment.js'), 'module.exports = {};\n');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', 'done, high-risk path']);
  }

  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  return dir;
}

function reviewFiles(dir) {
  const runs = path.join(dir, '.coding-flow', 'runs');
  return fs.existsSync(runs) ? fs.readdirSync(runs).filter((name) => name.endsWith('-review.json')) : [];
}

function storyStatus(dir) {
  const data = JSON.parse(run(dir, ['status', '--json']).output);
  return data.epics.flatMap((epic) => epic.stories).find((story) => story.path === STORY);
}

test('a pass with an open P1 is refused and nothing is written', (t) => {
  const dir = repo(t);
  const res = run(dir, ['review', 'capture', '--story', STORY, '--verdict', 'pass', '--p1', '1']);

  assert.equal(res.code, 1, res.output);
  assert.match(res.output, /--accept/);
  assert.deepEqual(reviewFiles(dir), []);
});

test('a pass with an open P0 is refused too', (t) => {
  const dir = repo(t);
  assert.equal(run(dir, ['review', 'capture', '--story', STORY, '--verdict', 'pass', '--p0', '1']).code, 1);
  assert.deepEqual(reviewFiles(dir), []);
});

test('--accept records the reason as acceptedRisk', (t) => {
  const dir = repo(t);
  const res = run(dir, ['review', 'capture', '--story', STORY, '--verdict', 'pass', '--p1', '1', '--accept', 'tracked in #12', '--json']);

  assert.equal(res.code, 0, res.output);
  assert.equal(JSON.parse(res.output).acceptedRisk, 'tracked in #12');
  assert.equal(reviewFiles(dir).length, 1);
});

test('a blank --accept does not count', (t) => {
  const dir = repo(t);
  assert.equal(run(dir, ['review', 'capture', '--story', STORY, '--verdict', 'pass', '--p1', '1', '--accept', '  ']).code, 1);
  assert.deepEqual(reviewFiles(dir), []);
});

test('a clean pass, and a fail with open findings, need no acceptance', (t) => {
  const dir = repo(t);
  const clean = run(dir, ['review', 'capture', '--story', STORY, '--verdict', 'pass', '--p2', '3', '--json']);
  assert.equal(clean.code, 0, clean.output);
  assert.equal(JSON.parse(clean.output).acceptedRisk, undefined);

  // exit 1 is the existing meaning of a failing verdict; the file is still written.
  assert.equal(run(dir, ['review', 'capture', '--story', STORY, '--verdict', 'fail', '--p1', '2']).code, 1);
  assert.equal(reviewFiles(dir).length, 2);
});

test('status shows (self) for a STRICT story passed by its own author, and exposes reviewer', (t) => {
  const dir = repo(t, { strict: true });
  assert.equal(run(dir, ['review', 'capture', '--story', STORY, '--verdict', 'pass']).code, 0);

  assert.equal(storyStatus(dir).reviewer, 'self');
  assert.match(run(dir, ['status']).output, /review: pass \(self\)/);
});

test('status has no (self) for a subagent review, nor for a non-STRICT story', (t) => {
  const strict = repo(t, { strict: true });
  assert.equal(run(strict, ['review', 'capture', '--story', STORY, '--verdict', 'pass', '--reviewer', 'subagent']).code, 0);
  assert.doesNotMatch(run(strict, ['status']).output, /\(self\)/);
  assert.equal(storyStatus(strict).reviewer, 'subagent');

  const plain = repo(t);
  assert.equal(run(plain, ['review', 'capture', '--story', STORY, '--verdict', 'pass']).code, 0);
  assert.doesNotMatch(run(plain, ['status']).output, /\(self\)/);
});

test('audit counts reviews by reviewer and lists accepted and pre-rule passes', (t) => {
  const dir = repo(t);
  run(dir, ['review', 'capture', '--story', STORY, '--verdict', 'pass', '--p1', '1', '--accept', 'tracked in #12']);
  run(dir, ['review', 'capture', '--story', STORY, '--verdict', 'pass', '--reviewer', 'subagent']);

  // A review written before the rule: pass + P1, no acceptedRisk.
  const runs = path.join(dir, '.coding-flow', 'runs');
  const legacy = JSON.parse(fs.readFileSync(path.join(runs, reviewFiles(dir)[0]), 'utf8'));
  delete legacy.acceptedRisk;
  legacy.generatedAt = '2020-01-01T00:00:00.000Z';
  fs.writeFileSync(path.join(runs, '2020-01-01T00-00-00-000Z-review.json'), JSON.stringify(legacy));

  const out = run(dir, ['audit']).output;
  assert.match(out, /Reviews: 3 captured \(.*2 self.*\)/);
  assert.match(out, /1 subagent/);
  assert.match(out, /pass with accepted P0\/P1: .*tracked in #12/);
  assert.match(out, /pass with open P1 \(pre-0\.13\)/);
});
