'use strict';

// Epic/story numbers are picked from a local scan of `epics/` at plan time —
// there is no shared counter. Two people branching from the same base can
// independently land on the same `epic-05-` (or the same story number inside
// one epic) with different slugs: no Git conflict, since the directory names
// differ, but the number stops being unique once both branches merge. `doctor`
// catches that mechanically, right when it is still a one-line rename.

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

function project(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `coding-flow-${prefix}-`));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(run(dir, ['init']).code, 0);
  return dir;
}

function writeEpic(dir, epicName) {
  fs.mkdirSync(path.join(dir, 'epics', epicName), { recursive: true });
  fs.writeFileSync(path.join(dir, 'epics', epicName, 'index.md'), `# ${epicName}\n`);
}

function writeStory(dir, epicName, storyName) {
  const storyDir = path.join(dir, 'epics', epicName, storyName);
  fs.mkdirSync(storyDir, { recursive: true });
  fs.writeFileSync(path.join(storyDir, 'story.md'), `# ${storyName}\n`);
}

function warnings(dir) {
  const res = run(dir, ['doctor', '--json']);
  assert.equal(res.code, 0, res.output);
  return JSON.parse(res.output).warnings;
}

test('doctor warns when two epics independently claim the same number', (t) => {
  const dir = project(t, 'epic-dup');
  writeEpic(dir, 'epic-05-payments');
  writeEpic(dir, 'epic-05-notifications');

  const found = warnings(dir).find((w) => w.code === 'duplicate_epic_number');
  assert.ok(found, 'expected a duplicate_epic_number warning');
  assert.match(found.message, /epic-05- is used by 2 epics/);
  assert.match(found.message, /epic-05-payments/);
  assert.match(found.message, /epic-05-notifications/);
});

test('doctor stays quiet when epic numbers are unique', (t) => {
  const dir = project(t, 'epic-unique');
  writeEpic(dir, 'epic-01-payments');
  writeEpic(dir, 'epic-02-notifications');

  assert.ok(!warnings(dir).some((w) => w.code === 'duplicate_epic_number'));
});

test('doctor warns when two stories in the same epic independently claim the same number', (t) => {
  const dir = project(t, 'story-dup');
  writeStory(dir, 'epic-01-checkout', 'story-01-02-apply-coupon');
  writeStory(dir, 'epic-01-checkout', 'story-01-02-guest-checkout');

  const found = warnings(dir).find((w) => w.code === 'duplicate_story_number');
  assert.ok(found, 'expected a duplicate_story_number warning');
  assert.match(found.message, /epic-01-checkout has 2 stories numbered -02-/);
  assert.equal(found.file, 'epics/epic-01-checkout');
});

test('doctor does not confuse the same story number in two different epics', (t) => {
  const dir = project(t, 'story-cross-epic');
  writeStory(dir, 'epic-01-checkout', 'story-01-01-cart');
  writeStory(dir, 'epic-02-billing', 'story-02-01-invoices');

  assert.ok(!warnings(dir).some((w) => w.code === 'duplicate_story_number'));
});

test('the duplicate-numbering warning is advisory only — never fails the install', (t) => {
  const dir = project(t, 'dup-advisory');
  writeEpic(dir, 'epic-05-payments');
  writeEpic(dir, 'epic-05-notifications');

  const { code, output } = run(dir, ['doctor']);
  assert.equal(code, 0, output);
  assert.match(output, /two branches likely picked the same number independently/);
});
