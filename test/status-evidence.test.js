'use strict';

// Contract tests for evidence-backed story status.
//
// A story's status must be driven by executed proof, not by prose: a captured
// `verify` (green -> "verified", red -> "blocked") outranks the legacy keyword
// heuristic, while an explicit `## Status` in the notes stays authoritative (a
// human override). This closes the old gap where "done" was just something the
// agent asserted. We verify the pure resolver directly, then the same behavior
// end-to-end through the CLI on a throwaway project.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { inferStoryStatus } = require('../bin/lib/storage/local');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `coding-flow-${prefix}-`));
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

// --- unit: the pure resolver -------------------------------------------------

function storyDirWithNotes(t, notes) {
  const dir = tmp('status-unit');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  if (notes != null) {
    fs.writeFileSync(path.join(dir, 'tasks.md'), notes);
  }
  return dir;
}

test('no notes, no verify -> planned', (t) => {
  const dir = storyDirWithNotes(t, null);
  assert.equal(inferStoryStatus(dir, { verify: null }), 'planned');
});

test('a green verify makes a story "verified" even with sparse notes', (t) => {
  const dir = storyDirWithNotes(t, '# Notes\n\nshort\n');
  assert.equal(inferStoryStatus(dir, { verify: 'pass' }), 'verified');
});

test('a red verify makes a story "blocked" even if the notes claim success', (t) => {
  const dir = storyDirWithNotes(t, '# Notes\n\nvalidation pass, all good\n');
  assert.equal(inferStoryStatus(dir, { verify: 'fail' }), 'blocked');
});

test('an explicit ## Status overrides the verify signal (human authority)', (t) => {
  const dir = storyDirWithNotes(t, '# Notes\n\n## Status\n\ndone\n');
  assert.equal(inferStoryStatus(dir, { verify: 'fail' }), 'done');
});

test('legacy prose heuristic still applies when no evidence exists', (t) => {
  const passDir = storyDirWithNotes(t, '# Notes\n\nvalidation results: all pass\n');
  assert.equal(inferStoryStatus(passDir, { verify: null }), 'done');

  const blockedDir = storyDirWithNotes(t, '# Notes\n\nhit a stop condition here\n');
  assert.equal(inferStoryStatus(blockedDir, { verify: null }), 'blocked');
});

// A story nobody has started reads like a success to the prose heuristic: its
// checklist says "## Validation Tasks" and "- [ ] npm test passes". That is the
// plan, not an outcome, so it must stay "planned".
test('an untouched checklist is not read as a passing validation', (t) => {
  const dir = storyDirWithNotes(t, '# Tasks\n\n## Implementation Tasks\n\n- [ ] Create it.\n\n## Validation Tasks\n\n- [ ] `npm test` passes.\n');
  assert.equal(inferStoryStatus(dir, { verify: null }), 'planned');
});

// --- integration: status reads the run evidence through the CLI --------------

function projectWithStory(t, prefix) {
  const dir = tmp(prefix);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  run(dir, ['init']);
  const storyRel = 'epics/epic-01-x/story-01-01-y';
  fs.mkdirSync(path.join(dir, storyRel), { recursive: true });
  fs.writeFileSync(path.join(dir, storyRel, 'spec.md'), '# Story 01.01\n');
  return { dir, storyRel };
}

function setValidationCommands(dir, commands) {
  const configPath = path.join(dir, '.coding-flow', 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.validation = { commands };
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

function statusOf(dir, storyRel) {
  const { code, output } = run(dir, ['status', '--json']);
  assert.equal(code, 0, `status --json must exit 0 (${output})`);
  const data = JSON.parse(output);
  for (const epic of data.epics) {
    for (const story of epic.stories) {
      if (story.path === storyRel) {
        return story.status;
      }
    }
  }
  throw new Error(`story ${storyRel} not found in status output`);
}

test('status shows "planned" before any verify, then "verified" after a green one', (t) => {
  const { dir, storyRel } = projectWithStory(t, 'status-green');
  assert.equal(statusOf(dir, storyRel), 'planned', 'no evidence yet');

  setValidationCommands(dir, ['node -e "process.exit(0)"']);
  const { code } = run(dir, ['harness', 'verify', '--story', storyRel]);
  assert.equal(code, 0, 'green verify must exit 0');

  assert.equal(statusOf(dir, storyRel), 'verified', 'a captured green verify backs the status');
});

test('a red verify surfaces as "blocked" in status', (t) => {
  const { dir, storyRel } = projectWithStory(t, 'status-red');
  setValidationCommands(dir, ['node -e "process.exit(3)"']);
  const { code } = run(dir, ['harness', 'verify', '--story', storyRel]);
  assert.equal(code, 1, 'red verify must exit 1');

  assert.equal(statusOf(dir, storyRel), 'blocked', 'a captured red verify blocks the status');
});

test('the latest verify wins: red then green -> verified', (t) => {
  const { dir, storyRel } = projectWithStory(t, 'status-latest');

  setValidationCommands(dir, ['node -e "process.exit(3)"']);
  run(dir, ['harness', 'verify', '--story', storyRel]);
  assert.equal(statusOf(dir, storyRel), 'blocked');

  setValidationCommands(dir, ['node -e "process.exit(0)"']);
  run(dir, ['harness', 'verify', '--story', storyRel]);
  assert.equal(statusOf(dir, storyRel), 'verified', 'the most recent evidence must win');
});

// A single-file story.md opens with its own description. That is the brief, not
// progress: without a `## Status` or `## Result` it is still "planned".
const SINGLE_FILE_STORY = [
  '# Story 11-04 — a thing',
  '',
  'A prose paragraph describing the story, long enough to cross the heuristic threshold: '.repeat(3),
  '',
  '*(QUICK — one function and its test.)*',
  '',
  '## Acceptance Criteria',
  '',
  '- [ ] It works.',
  '',
].join('\n');

function singleFileStoryDir(t, content) {
  const dir = tmp('status-single');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'story.md'), content);
  return dir;
}

test('a single-file story is planned despite its opening description', (t) => {
  const dir = singleFileStoryDir(t, SINGLE_FILE_STORY);
  assert.equal(inferStoryStatus(dir, { verify: null }), 'planned');
});

test('a single-file story with a long ## Result is still in-progress', (t) => {
  const dir = singleFileStoryDir(t, `${SINGLE_FILE_STORY}\n## Result\n\n${'Changed the thing and moved on. '.repeat(8)}\n`);
  assert.equal(inferStoryStatus(dir, { verify: null }), 'in-progress');
});

test('a split tasks.md keeps its prose notes outside ## Result', (t) => {
  const dir = storyDirWithNotes(t, `# Tasks\n\n${'Working on it, a long note outside any result section. '.repeat(5)}\n`);
  assert.equal(inferStoryStatus(dir, { verify: null }), 'in-progress');
});

test('wrapped lines of an unchecked criterion are the plan, not progress', (t) => {
  const wrapped = `${SINGLE_FILE_STORY}\n- [ ] ${'A long criterion that wraps onto the next line '.repeat(2)}\n      ${'and keeps going well past the threshold. '.repeat(5)}\n`;
  const dir = singleFileStoryDir(t, wrapped);
  assert.equal(inferStoryStatus(dir, { verify: null }), 'planned');
});
