'use strict';

// Unit tests for `epicCompleteness`, the gate that decides whether `ship` may
// auto-merge a PR. It must never trust a story's written `## Status: done` alone
// — only a captured green verify counts, because a written label can come from
// an agent (or a human) that never actually ran anything.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { epicCompleteness, openSiblingsAhead } = require('../bin/lib/ship');

const CONFIG = { storage: 'local' };

function writeStory(root, epicName, storyName, { statusLine = '## Status: done' } = {}) {
  const dir = path.join(root, 'epics', epicName, storyName);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'story.md'), `# ${storyName}\n\n${statusLine}\n`);
  return path.posix.join('epics', epicName, storyName);
}

function writeVerify(root, storyPath, { ok = true } = {}) {
  const dir = path.join(root, '.coding-flow', 'runs');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${Date.now()}-${Math.random().toString(36).slice(2)}-verify.json`);
  fs.writeFileSync(
    file,
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      story: storyPath,
      ok,
      commandsFound: 1,
      results: [{ command: 'npm test', ok, exitCode: ok ? 0 : 1 }],
    }),
  );
}

function tempRoot(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-automerge-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('epicCompleteness refuses a story marked done in prose with no captured verify', (t) => {
  const root = tempRoot(t);
  writeStory(root, 'epic-01-x', 'story-01-01-a');

  const result = epicCompleteness(root, CONFIG, 'story-01-01-a');
  assert.equal(result.eligible, false, 'a written "done" alone must not be enough');
  assert.match(result.reason, /no captured green verify/);
  assert.match(result.reason, /story-01-01-a/);
});

test('epicCompleteness refuses when only some stories of the epic are proven', (t) => {
  const root = tempRoot(t);
  const storyA = writeStory(root, 'epic-01-x', 'story-01-01-a');
  writeStory(root, 'epic-01-x', 'story-01-02-b');
  writeVerify(root, storyA, { ok: true });

  const result = epicCompleteness(root, CONFIG, 'story-01-01-a');
  assert.equal(result.eligible, false);
  assert.match(result.reason, /1\/2/);
  assert.match(result.reason, /story-01-02-b/);
});

test('epicCompleteness refuses when a story\'s latest verify failed', (t) => {
  const root = tempRoot(t);
  const storyA = writeStory(root, 'epic-01-x', 'story-01-01-a');
  const storyB = writeStory(root, 'epic-01-x', 'story-01-02-b');
  writeVerify(root, storyA, { ok: true });
  writeVerify(root, storyB, { ok: false });

  const result = epicCompleteness(root, CONFIG, 'story-01-01-a');
  assert.equal(result.eligible, false);
  assert.match(result.reason, /story-01-02-b/);
});

test('epicCompleteness is eligible once every story has a captured green verify', (t) => {
  const root = tempRoot(t);
  const storyA = writeStory(root, 'epic-01-x', 'story-01-01-a');
  const storyB = writeStory(root, 'epic-01-x', 'story-01-02-b');
  writeVerify(root, storyA, { ok: true });
  writeVerify(root, storyB, { ok: true });

  const result = epicCompleteness(root, CONFIG, 'story-01-01-a');
  assert.equal(result.eligible, true);
  assert.equal(result.epicName, 'epic-01-x');
});

test('epicCompleteness refuses a branch not linked to any known story', (t) => {
  const root = tempRoot(t);
  writeStory(root, 'epic-01-x', 'story-01-01-a');

  const result = epicCompleteness(root, CONFIG, 'feat/unrelated');
  assert.equal(result.eligible, false);
  assert.match(result.reason, /not linked/);
});

// --- openSiblingsAhead: merge order within an epic --------------------------
// Story branches are cut independently from the base, so nothing stops GitHub
// from merging story-02 before story-01 the moment both go green together —
// exactly the race Walking Skeleton exists to prevent.

function epicOf(...names) {
  return { name: 'epic-01-x', stories: names.map((name) => ({ name })) };
}

test('openSiblingsAhead: the first story in the epic has nothing ahead of it', () => {
  const epic = epicOf('story-01-01-a', 'story-01-02-b');
  const blockers = openSiblingsAhead(epic, 'story-01-01-a', () => true);
  assert.deepEqual(blockers, []);
});

test('openSiblingsAhead: blocks on an earlier story whose PR is still open', () => {
  const epic = epicOf('story-01-01-a', 'story-01-02-b');
  const blockers = openSiblingsAhead(epic, 'story-01-02-b', (name) => name === 'story-01-01-a');
  assert.deepEqual(blockers, ['story-01-01-a']);
});

test('openSiblingsAhead: an earlier story already merged (no open PR) does not block', () => {
  const epic = epicOf('story-01-01-a', 'story-01-02-b');
  const blockers = openSiblingsAhead(epic, 'story-01-02-b', () => false);
  assert.deepEqual(blockers, []);
});

test('openSiblingsAhead: a later story being open never blocks an earlier one', () => {
  const epic = epicOf('story-01-01-a', 'story-01-02-b');
  const blockers = openSiblingsAhead(epic, 'story-01-01-a', (name) => name === 'story-01-02-b');
  assert.deepEqual(blockers, []);
});

test('openSiblingsAhead: reports every still-open earlier story, in order', () => {
  const epic = epicOf('story-01-01-a', 'story-01-02-b', 'story-01-03-c');
  const blockers = openSiblingsAhead(epic, 'story-01-03-c', () => true);
  assert.deepEqual(blockers, ['story-01-01-a', 'story-01-02-b']);
});

test('openSiblingsAhead: order is derived from the name, not array position', () => {
  // epic.stories is not guaranteed sorted by the storage layer (fs.readdirSync
  // makes no ordering promise) — the check must not trust incoming order.
  const epic = epicOf('story-01-02-b', 'story-01-01-a');
  const blockers = openSiblingsAhead(epic, 'story-01-02-b', () => true);
  assert.deepEqual(blockers, ['story-01-01-a']);
});
