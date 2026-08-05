'use strict';

// A QUICK story is one `story.md`, not three files. The split (spec / plan /
// tasks) earns itself on a story worth a day; on a copy change it is three files
// to create, re-read every turn, and update at the end.
//
// The bar this file holds: a single-file story must be exactly as provable as a
// three-file one. Cheaper ceremony, identical proof.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');

function run(cwd, args) {
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' });
  return {
    code: result.status ?? 1,
    output: `${result.stdout || ''}${result.stderr || ''}`,
    stdout: result.stdout || '',
  };
}

function makeProject(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `coding-flow-${prefix}-`));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(run(dir, ['init']).code, 0);

  execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 't@e.com'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'T'], { cwd: dir, stdio: 'ignore' });

  return dir;
}

// One file carrying every section the three-file shape spreads across three.
function writeSingleFileStory(dir, { status = '', result = '' } = {}) {
  const storyDir = path.join(dir, 'epics', 'epic-01-demo', 'story-01-01-copy');
  fs.mkdirSync(storyDir, { recursive: true });
  fs.writeFileSync(
    path.join(storyDir, 'story.md'),
    [
      '# Update the hero heading',
      '',
      '## Acceptance criteria',
      '',
      '- The hero shows the new heading.',
      '',
      '## Commands',
      '',
      '```',
      'node -e "process.exit(0)"',
      '```',
      '',
      status,
      '',
      '## Result',
      '',
      result,
      '',
    ].join('\n'),
  );

  return 'epics/epic-01-demo/story-01-01-copy';
}

// `status` prints the directory name; the title travels in --json and in run reports.
function storyEntry(dir, name) {
  const listing = JSON.parse(run(dir, ['status', '--json']).stdout);
  return listing.epics.flatMap((epic) => epic.stories).find((story) => story.name === name);
}

test('a single-file story is listed with its real title', (t) => {
  const dir = makeProject(t, 'sfs-status');
  writeSingleFileStory(dir);

  // Falling back to the directory name would mean story.md was never read.
  assert.equal(storyEntry(dir, 'story-01-01-copy').title, 'Update the hero heading');
});

test('verify reads the commands from story.md', (t) => {
  const dir = makeProject(t, 'sfs-verify');
  const story = writeSingleFileStory(dir);

  const { code, output } = run(dir, ['verify', '--story', story]);
  assert.equal(code, 0, output);
  assert.match(output, /Commands from: plan\.md/, 'the plan role must resolve to story.md');
  assert.match(output, /passed/);
});

test('a single-file story reaches verified, exactly like a three-file one', (t) => {
  const dir = makeProject(t, 'sfs-verified');
  const story = writeSingleFileStory(dir);

  execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-qm', 'story'], { cwd: dir, stdio: 'ignore' });

  assert.equal(run(dir, ['verify', '--story', story]).code, 0);

  const { output } = run(dir, ['status']);
  assert.match(output, /verified/, 'cheaper ceremony must not mean weaker proof');
});

test('an explicit ## Status in story.md still overrides the machine signal', (t) => {
  const dir = makeProject(t, 'sfs-override');
  writeSingleFileStory(dir, { status: '## Status: blocked' });

  const { output } = run(dir, ['status']);
  assert.match(output, /blocked/);
});

test('the ## Status form the skill mandates is the form the tool reads', (t) => {
  const dir = makeProject(t, 'sfs-status-syntax');

  // `flow-run` instructs agents to write `## Status: done`. The colon was the one
  // form the matcher rejected, so the most authoritative of the three status
  // signals was inert for exactly the syntax the skill mandates — a story marked
  // blocked after a red verify silently fell through to the prose heuristic.
  for (const [line, expected] of [
    ['## Status: blocked', 'blocked'],
    ['## Status blocked', 'blocked'],
    ['## Status: in-progress', 'in-progress'],
  ]) {
    const storyDir = path.join(dir, 'epics', 'epic-01-demo', 'story-01-01-syntax');
    fs.mkdirSync(storyDir, { recursive: true });
    fs.writeFileSync(path.join(storyDir, 'story.md'), `# T\n\n${line}\n`);

    assert.equal(storyEntry(dir, 'story-01-01-syntax').status, expected, `${line} was not read`);
  }
});

test('harness check accepts a single-file story', (t) => {
  const dir = makeProject(t, 'sfs-check');
  const story = writeSingleFileStory(dir);

  const { code, output } = run(dir, ['harness', 'check', '--story', story]);
  assert.equal(code, 0, output);
  assert.doesNotMatch(output, /needs story content/);
});

test('an empty story directory is still refused', (t) => {
  const dir = makeProject(t, 'sfs-empty');
  const storyDir = path.join(dir, 'epics', 'epic-01-demo', 'story-01-01-empty');
  fs.mkdirSync(storyDir, { recursive: true });

  const { code, output } = run(dir, [
    'harness', 'check', '--story', 'epics/epic-01-demo/story-01-01-empty',
  ]);
  assert.equal(code, 1, 'the fallback must not turn "no story at all" into a valid story');
  assert.match(output, /needs story content/);
});

test('hasStoryContent recognises both shapes and neither', (t) => {
  const { hasStoryContent } = require('../bin/lib/story');
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-sfs-has-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));

  const make = (name, files) => {
    const dir = path.join(base, name);
    fs.mkdirSync(dir, { recursive: true });
    for (const file of files) fs.writeFileSync(path.join(dir, file), '# x\n');
    return dir;
  };

  assert.equal(hasStoryContent(make('single', ['story.md'])), true);
  assert.equal(hasStoryContent(make('split', ['spec.md'])), true);
  // `worktree` prints "(no story content)" off this; always-true would make the
  // hint meaningless rather than wrong, which is the harder kind of bug to spot.
  assert.equal(hasStoryContent(make('empty', [])), false);
  assert.equal(hasStoryContent(make('unrelated', ['notes.txt'])), false);
});

test('a three-file story is unaffected by the fallback', (t) => {
  const dir = makeProject(t, 'sfs-three');
  const storyDir = path.join(dir, 'epics', 'epic-01-demo', 'story-01-01-full');
  fs.mkdirSync(storyDir, { recursive: true });
  fs.writeFileSync(path.join(storyDir, 'spec.md'), '# Real spec title\n');
  fs.writeFileSync(path.join(storyDir, 'plan.md'), '## Commands\n\n```\nnode -e "process.exit(0)"\n```\n');
  fs.writeFileSync(path.join(storyDir, 'tasks.md'), '## Result\n\nDone.\n');
  // A story.md sitting alongside must never win over the dedicated files.
  fs.writeFileSync(path.join(storyDir, 'story.md'), '# Wrong title\n');

  assert.equal(storyEntry(dir, 'story-01-01-full').title, 'Real spec title');
});
