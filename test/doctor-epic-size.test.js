'use strict';

// The WIP-limit heuristic `/flow-plan` is told to apply (cap an epic around
// 5-7 stories, split the rest into a follow-up epic) is a prompt-level rule the
// model can drift from over a long session. `doctor` re-checks it mechanically
// from the actual files on disk, so a bloated epic surfaces even when nobody
// re-reads the skill.

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

function writeStories(dir, epicName, count) {
  for (let i = 1; i <= count; i += 1) {
    const storyName = `story-01-${String(i).padStart(2, '0')}-x`;
    const storyDir = path.join(dir, 'epics', epicName, storyName);
    fs.mkdirSync(storyDir, { recursive: true });
    fs.writeFileSync(path.join(storyDir, 'story.md'), `# ${storyName}\n`);
  }
}

function warnings(dir) {
  const res = run(dir, ['doctor', '--json']);
  assert.equal(res.code, 0, res.output);
  return JSON.parse(res.output).warnings;
}

test('doctor warns when an epic passes the story soft limit', (t) => {
  const dir = project(t, 'epic-oversized');
  writeStories(dir, 'epic-01-big', 8);

  const found = warnings(dir).find((w) => w.code === 'epic_too_large');
  assert.ok(found, 'expected an epic_too_large warning');
  assert.match(found.message, /epic-01-big has 8 stories/);
  assert.equal(found.file, 'epics/epic-01-big');
});

test('doctor stays quiet under the soft limit', (t) => {
  const dir = project(t, 'epic-normal');
  writeStories(dir, 'epic-01-normal', 5);

  assert.ok(!warnings(dir).some((w) => w.code === 'epic_too_large'));
});

test('the warning is advisory only — never fails the install', (t) => {
  const dir = project(t, 'epic-oversized-exit');
  writeStories(dir, 'epic-01-big', 9);

  const { code, output } = run(dir, ['doctor']);
  assert.equal(code, 0, output);
  assert.match(output, /split the remainder into a follow-up epic/);
});

test('a project with no epics yet is never warned', (t) => {
  const dir = project(t, 'epic-none');

  assert.ok(!warnings(dir).some((w) => w.code === 'epic_too_large'));
});
