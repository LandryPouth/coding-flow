'use strict';

// `/flow-plan` writes each `## Stories` entry as a link that opens the story's
// spec in the editor: `1. [story-…](story-…/spec.md) — outcome`. A prompt-level
// rule drifts (bold names, folder links, `([spec](…))` suffixes, plain bullets
// were all found in real epics), so `doctor` re-checks every entry from disk and
// `doctor --fix` rewrites the drifted ones to the canonical link.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { parseStoryDirs } = require('../bin/lib/backbone');

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

function project(t, prefix, initArgs = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `coding-flow-${prefix}-`));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(run(dir, ['init', ...initArgs]).code, 0);
  return dir;
}

// stories: { name: 'spec' | 'story' | 'folder' } — which file the story has.
function writeEpic(dir, epicName, stories, storiesSection) {
  const epicDir = path.join(dir, 'epics', epicName);
  fs.mkdirSync(epicDir, { recursive: true });
  for (const [name, shape] of Object.entries(stories)) {
    fs.mkdirSync(path.join(epicDir, name), { recursive: true });
    if (shape === 'spec') fs.writeFileSync(path.join(epicDir, name, 'spec.md'), `# ${name}\n`);
    if (shape === 'story') fs.writeFileSync(path.join(epicDir, name, 'story.md'), `# ${name}\n`);
  }
  const index = `# Epic\n\nIntro.\n\n## Stories\n\n${storiesSection.join('\n')}\n\n## Risks\n\n- none\n`;
  fs.writeFileSync(path.join(epicDir, 'index.md'), index);
  return path.join(epicDir, 'index.md');
}

function storyLinkWarnings(dir) {
  const res = run(dir, ['doctor', '--json']);
  return JSON.parse(res.output).warnings.filter((w) => w.code === 'story_entry_not_linked');
}

const STORIES = {
  'story-01-01-bold': 'spec',
  'story-01-02-tick': 'story',
  'story-01-03-title': 'spec',
  'story-01-04-suffix': 'spec',
  'story-01-05-plain': 'folder',
};

const DRIFTED = [
  '1. **story-01-01-bold** — first outcome *(STANDARD)*',
  '2. `story-01-02-tick` (FAST) — second outcome,',
  '   wrapped on a second line.',
  '3. [01-03 — A title](story-01-03-title/) — STRICT',
  '- **s4 and s5** are a note, not a story.',
  '4. **story-01-04-suffix** ([spec](story-01-04-suffix/spec.md)) — fourth',
  '- [ ] story-01-05-plain',
];

test('doctor warns for every entry that is not the canonical link, naming epic, line and expected link', (t) => {
  const dir = project(t, 'story-links-warn');
  writeEpic(dir, 'epic-01-x', STORIES, DRIFTED);

  const found = storyLinkWarnings(dir);
  assert.equal(found.length, 5, JSON.stringify(found, null, 2));
  assert.equal(found[0].file, 'epics/epic-01-x/index.md');
  assert.match(found[0].message, /epic-01-x\/index\.md:7: .*story-01-01-bold.* is not a link .*\[story-01-01-bold\]\(story-01-01-bold\/spec\.md\)/);
  assert.match(found[1].message, /\[story-01-02-tick\]\(story-01-02-tick\/story\.md\)/);
  assert.match(found[2].message, /links to story-01-03-title\/, not to its spec/);
  assert.match(found[4].message, /\[story-01-05-plain\]\(story-01-05-plain\/\)/);
});

test('doctor warns for a link whose target file does not exist', (t) => {
  const dir = project(t, 'story-links-missing');
  writeEpic(dir, 'epic-01-x', { 'story-01-01-a': 'story' }, ['1. [story-01-01-a](story-01-01-a/spec.md) — outcome']);

  const [warning] = storyLinkWarnings(dir);
  assert.ok(warning, 'expected a warning');
  assert.match(warning.message, /story-01-01-a\/spec\.md does not exist .*\[story-01-01-a\]\(story-01-01-a\/story\.md\)/);
});

test('canonical entries are never warned', (t) => {
  const dir = project(t, 'story-links-clean');
  writeEpic(dir, 'epic-01-x', { 'story-01-01-a': 'spec', 'story-01-02-b': 'story' }, [
    '1. [story-01-01-a](story-01-01-a/spec.md) — outcome *(STANDARD)*',
    '2. [story-01-02-b](story-01-02-b/story.md) — outcome *(FAST)*',
  ]);

  assert.deepEqual(storyLinkWarnings(dir), []);
});

test('the warning is advisory only — never fails the install', (t) => {
  const dir = project(t, 'story-links-exit');
  writeEpic(dir, 'epic-01-x', STORIES, DRIFTED);

  const { code, output } = run(dir, ['doctor']);
  assert.equal(code, 0, output);
  assert.match(output, /is not a link/);
});

test('doctor --fix rewrites each entry to the canonical link and keeps the rest of the text', (t) => {
  const dir = project(t, 'story-links-fix');
  const indexPath = writeEpic(dir, 'epic-01-x', STORIES, DRIFTED);
  const before = fs.readFileSync(indexPath, 'utf8');

  assert.equal(run(dir, ['doctor', '--fix']).code, 0);

  const after = fs.readFileSync(indexPath, 'utf8');
  assert.equal(
    after,
    before.replace(
      DRIFTED.join('\n'),
      [
        '1. [story-01-01-bold](story-01-01-bold/spec.md) — first outcome *(STANDARD)*',
        '2. [story-01-02-tick](story-01-02-tick/story.md) (FAST) — second outcome,',
        '   wrapped on a second line.',
        '3. [story-01-03-title](story-01-03-title/spec.md) — A title — STRICT',
        '- **s4 and s5** are a note, not a story.',
        '4. [story-01-04-suffix](story-01-04-suffix/spec.md) — fourth',
        '- [ ] [story-01-05-plain](story-01-05-plain/)',
      ].join('\n'),
    ),
  );
  assert.deepEqual(parseStoryDirs(after), parseStoryDirs(before));
  assert.deepEqual(storyLinkWarnings(dir), []);
});

test('doctor --fix normalizes story links on a minimal install too', (t) => {
  const dir = project(t, 'story-links-minimal', ['--minimal']);
  const indexPath = writeEpic(dir, 'epic-01-x', { 'story-01-01-a': 'spec' }, ['1. **story-01-01-a** — outcome']);

  assert.equal(storyLinkWarnings(dir).length, 1);
  assert.equal(run(dir, ['doctor', '--fix']).code, 0);
  assert.match(fs.readFileSync(indexPath, 'utf8'), /^1\. \[story-01-01-a\]\(story-01-01-a\/spec\.md\) — outcome$/m);
});

test('a story listed with no folder on disk is warned, and --fix leaves it alone', (t) => {
  const dir = project(t, 'story-links-nofolder');
  const indexPath = writeEpic(dir, 'epic-01-x', {}, ['1. **story-01-01-gone** — outcome']);

  const [warning] = storyLinkWarnings(dir);
  assert.match(warning.message, /story-01-01-gone has no folder/);
  run(dir, ['doctor', '--fix']);
  assert.match(fs.readFileSync(indexPath, 'utf8'), /^1\. \*\*story-01-01-gone\*\* — outcome$/m);
});
