'use strict';

// `ai-flow audit --decisions`: a cross-epic, read-only view of every story's
// recorded `## Decisions` section. No new file to maintain by hand — the story
// files are already the source of truth, this only aggregates what is there.

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
  fs.mkdirSync(path.join(dir, '.coding-flow'), { recursive: true });
  return dir;
}

function writeStoryFile(dir, epicName, storyName, fileName, content) {
  const storyDir = path.join(dir, 'epics', epicName, storyName);
  fs.mkdirSync(storyDir, { recursive: true });
  fs.writeFileSync(path.join(storyDir, fileName), content);
}

test('audit --decisions is empty when no story records a Decisions section', (t) => {
  const dir = project(t, 'decisions-empty');
  writeStoryFile(dir, 'epic-01-x', 'story-01-01-a', 'story.md', '# Story\n\nNo decisions here.\n');

  const { code, output } = run(dir, ['audit', '--decisions']);
  assert.equal(code, 0, output);
  assert.match(output, /No recorded decisions found/);
});

test('audit --decisions lists a recorded decision from plan.md', (t) => {
  const dir = project(t, 'decisions-plan');
  writeStoryFile(
    dir,
    'epic-01-x',
    'story-01-01-a',
    'plan.md',
    '# Plan\n\n## Decisions\n\n- Decision: use Postgres.\n  - Reason: already the prod store.\n\n## Test Plan\n\nirrelevant\n',
  );

  const { code, output } = run(dir, ['audit', '--decisions']);
  assert.equal(code, 0, output);
  assert.match(output, /epic-01-x \/ story-01-01-a/);
  assert.match(output, /use Postgres/);
  assert.doesNotMatch(output, /irrelevant/, 'must stop at the next heading');
});

test('audit --decisions falls back to story.md when there is no plan.md', (t) => {
  const dir = project(t, 'decisions-story');
  writeStoryFile(
    dir,
    'epic-01-x',
    'story-01-01-a',
    'story.md',
    '# Story\n\n## Decisions\n\n- Kept the existing naming convention.\n',
  );

  const { output } = run(dir, ['audit', '--decisions']);
  assert.match(output, /Kept the existing naming convention/);
});

test('a Decisions heading with nothing under it does not count as recorded', (t) => {
  const dir = project(t, 'decisions-blank');
  writeStoryFile(dir, 'epic-01-x', 'story-01-01-a', 'story.md', '# Story\n\n## Decisions\n\n## Result\n\nfilled in later\n');

  const { output } = run(dir, ['audit', '--decisions']);
  assert.match(output, /No recorded decisions found/);
});

test('audit --decisions --json returns structured entries', (t) => {
  const dir = project(t, 'decisions-json');
  writeStoryFile(dir, 'epic-01-x', 'story-01-01-a', 'plan.md', '# Plan\n\n## Decisions\n\n- Decision: A.\n');
  writeStoryFile(dir, 'epic-02-y', 'story-02-01-b', 'plan.md', '# Plan\n\n## Decisions\n\n- Decision: B.\n');

  const { code, output } = run(dir, ['audit', '--decisions', '--json']);
  assert.equal(code, 0, output);
  const entries = JSON.parse(output);
  assert.equal(entries.length, 2);
  assert.deepEqual(
    entries.map((e) => [e.epic, e.story]),
    [
      ['epic-01-x', 'story-01-01-a'],
      ['epic-02-y', 'story-02-01-b'],
    ],
  );
  assert.match(entries[0].decisions, /Decision: A\./);
});

test('audit --decisions --export writes docs/DECISIONS.md grouped by epic', (t) => {
  const dir = project(t, 'decisions-export');
  writeStoryFile(dir, 'epic-01-x', 'story-01-01-a', 'plan.md', '# Plan\n\n## Decisions\n\n- Decision: A.\n');
  writeStoryFile(dir, 'epic-01-x', 'story-01-02-b', 'plan.md', '# Plan\n\n## Decisions\n\n- Decision: B.\n');

  const { code, output } = run(dir, ['audit', '--decisions', '--export']);
  assert.equal(code, 0, output);
  assert.match(output, /Exported 2 decision\(s\)/);

  const exported = fs.readFileSync(path.join(dir, 'docs', 'DECISIONS.md'), 'utf8');
  assert.match(exported, /^# Decisions/);
  assert.match(exported, /## epic-01-x/);
  assert.match(exported, /### story-01-01-a/);
  assert.match(exported, /### story-01-02-b/);
  assert.match(exported, /Decision: A\./);
  assert.match(exported, /Decision: B\./);
});

test('audit --decisions --export --dry-run writes nothing', (t) => {
  const dir = project(t, 'decisions-export-dry');
  writeStoryFile(dir, 'epic-01-x', 'story-01-01-a', 'plan.md', '# Plan\n\n## Decisions\n\n- Decision: A.\n');

  const { code, output } = run(dir, ['audit', '--decisions', '--export', '--dry-run']);
  assert.equal(code, 0, output);
  assert.match(output, /Would export 1 decision\(s\)/);
  assert.ok(!fs.existsSync(path.join(dir, 'docs', 'DECISIONS.md')));
});

test('audit --decisions never touches the run-evidence ledger', (t) => {
  const dir = project(t, 'decisions-ledger');
  writeStoryFile(dir, 'epic-01-x', 'story-01-01-a', 'plan.md', '# Plan\n\n## Decisions\n\n- Decision: A.\n');

  run(dir, ['audit', '--decisions']);
  assert.ok(!fs.existsSync(path.join(dir, '.coding-flow', 'ledger.jsonl')));
});
